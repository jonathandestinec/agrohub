import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Outside a React server render, react's cache() just calls through. To test the memoizing
// behaviour we replace it with a per-"request" Map memo (React compares arguments by identity;
// ours uses JSON, which is stricter than React and fine for string arguments). newRequest()
// forgets everything, like the end of a request does.
const memo = vi.hoisted(() => ({ stores: [] as Map<string, unknown>[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const store = new Map<string, unknown>();
      memo.stores.push(store);
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args));
        return store.get(key) as R;
      };
    },
  };
});
function newRequest() {
  for (const store of memo.stores) store.clear();
}

// Each simulated request carries its own cookies; AsyncLocalStorage lets two run concurrently.
type Jar = { token: string | null; active: string | null };
const als = new AsyncLocalStorage<Jar>();
const getSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => {
        getSession();
        const jar = als.getStore()!;
        if (!jar.token) return null;
        // The token is the user id, and u-admin has no two-factor.
        return {
          user: {
            id: jar.token,
            email: `${jar.token}@example.com`,
            name: jar.token,
            twoFactorEnabled: jar.token !== "admin",
          },
          session: { id: "s" },
        };
      },
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => {
    const jar = als.getStore()!;
    return {
      get: (name: string) =>
        name === "activeMembershipId" && jar.active ? { value: jar.active } : undefined,
      toString: () =>
        [jar.token && `session=${jar.token}`, jar.active && `activeMembershipId=${jar.active}`]
          .filter(Boolean)
          .join("; "),
    };
  },
}));

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { noteMembershipChange } from "@/modules/identity/cache-generation";
import { addMembership, becomeBuyer } from "@/modules/identity/service";
import { currentUser, getActor, getSession as cachedSession } from "@/modules/identity/session";
import { createTestCooperative } from "./helpers";

async function clean() {
  await prisma.membership.deleteMany();
  await prisma.cooperative.deleteMany();
  await prisma.user.deleteMany();
}
async function makeUser(id: string) {
  return prisma.user.create({
    data: {
      id,
      name: id,
      email: `${id}@example.com`,
      phone: "+2348012345678",
      consentAcceptedAt: new Date(),
    },
  });
}
const as = <T>(jar: Partial<Jar>, fn: () => Promise<T>) =>
  als.run({ token: null, active: null, ...jar }, fn);

let coop: string;
let findMany: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  getSession.mockReset();
  newRequest();
  await clean();
  for (const id of ["u1", "u2", "admin"]) await makeUser(id);
  coop = (await createTestCooperative()).id;
  findMany = vi.spyOn(prisma.membership, "findMany");
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("per-request identity cache", () => {
  it("looks up the session and memberships once for repeated getActor calls", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await as({ token: "u1" }, async () => {
      const [a, b, c] = await Promise.all([getActor(), getActor(), getActor()]);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("shares one session read between getActor, currentUser and getSession", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await as({ token: "u1" }, async () => {
      await getActor();
      await currentUser();
      await cachedSession();
    });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("recomputes on the next request", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await as({ token: "u1" }, () => getActor());
    newRequest();
    await as({ token: "u1" }, () => getActor());
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("recomputes when the active-role cookie changes within the request", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    const farmer = await addMembership({ userId: "u1", role: "FARMER", cooperativeId: coop });
    const buyer = (await prisma.membership.findFirstOrThrow({ where: { role: "BUYER" } })).id;
    const first = await as({ token: "u1", active: buyer }, () => getActor());
    const second = await as({ token: "u1", active: farmer.id }, () => getActor());
    expect(first?.role).toBe("BUYER");
    expect(second?.role).toBe("FARMER");
  });

  it("recomputes after sign-out within the request", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    expect(await as({ token: "u1" }, () => getActor())).not.toBeNull();
    expect(await as({ token: null }, () => getActor())).toBeNull();
  });

  it("sees a membership the same request has just written", async () => {
    // A server action reads the actor, writes a membership, then the response re-renders the
    // layout in the same request: the re-render must see the new membership.
    await prisma.user.update({ where: { id: "u1" }, data: { emailVerified: true } });
    await as({ token: "u1" }, async () => {
      expect(await getActor()).toBeNull();
      await becomeBuyer({ userId: "u1" });
      expect(await getActor()).toMatchObject({ userId: "u1", role: "BUYER" });
    });
  });

  it("sees a membership ended by the same request", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await as({ token: "u1" }, async () => {
      expect(await getActor()).toMatchObject({ role: "BUYER" });
      await prisma.membership.updateMany({ where: { userId: "u1" }, data: { status: "LEFT" } });
      noteMembershipChange();
      expect(await getActor()).toBeNull();
    });
  });

  it("never shows one user's actor to another, in sequence or concurrently", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await addMembership({ userId: "u2", role: "FARMER", cooperativeId: coop });
    // Same request memo, different cookies, one after the other.
    expect((await as({ token: "u1" }, () => getActor()))?.userId).toBe("u1");
    expect((await as({ token: "u2" }, () => getActor()))?.userId).toBe("u2");
    expect((await as({ token: "u1" }, () => getActor()))?.userId).toBe("u1");
    // And all at once, many times over.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        as({ token: i % 2 ? "u1" : "u2" }, async () => {
          const [a, b, user] = await Promise.all([getActor(), getActor(), currentUser()]);
          return { want: i % 2 ? "u1" : "u2", a, b, user };
        }),
      ),
    );
    for (const r of results) {
      expect(r.a?.userId).toBe(r.want);
      expect(r.b?.userId).toBe(r.want);
      expect(r.user?.userId).toBe(r.want);
    }
    const u2 = results.find((r) => r.want === "u2")!;
    expect(u2.a).toMatchObject({ role: "FARMER", cooperativeId: coop });
  });

  it("still throws 2FA_REQUIRED to every caller sharing a request", async () => {
    await addMembership({ userId: "admin", role: "ADMIN" });
    await as({ token: "admin" }, async () => {
      const errors = await Promise.all([
        getActor().catch((e) => e),
        getActor().catch((e) => e),
      ]);
      for (const e of errors) {
        expect(e).toBeInstanceOf(ForbiddenError);
        expect(e).toMatchObject({ code: "2FA_REQUIRED" });
      }
    });
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
