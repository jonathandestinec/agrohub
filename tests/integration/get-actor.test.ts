import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const cookieGet = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));

import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { getActor, requireActor } from "@/modules/identity/session";
import { UnauthenticatedError } from "@/lib/errors";
import { addMembership } from "@/modules/identity/service";

async function clean() {
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUser(id: string) {
  return prisma.user.create({
    data: {
      id,
      name: `User ${id}`,
      email: `${id}@example.com`,
      phone: "+2348012345678",
      consentAcceptedAt: new Date(),
    },
  });
}

function signedInAs(id: string, twoFactorEnabled = false) {
  getSession.mockResolvedValue({
    user: { id, email: `${id}@example.com`, twoFactorEnabled },
    session: { id: "s1" },
  });
}

beforeEach(async () => {
  getSession.mockReset();
  cookieGet.mockReset();
  cookieGet.mockReturnValue(undefined);
  await clean();
  await makeUser("u1");
  await makeUser("u2");
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("getActor", () => {
  it("returns null with no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getActor()).toBeNull();
  });

  it("rejects an ADMIN without two-factor with 2FA_REQUIRED", async () => {
    await addMembership({ userId: "u1", role: "ADMIN" });
    signedInAs("u1", false);
    const error = await getActor().catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ code: "2FA_REQUIRED" });
  });

  it("returns an Actor with twoFactorEnabled for an ADMIN who has it", async () => {
    await addMembership({ userId: "u1", role: "ADMIN" });
    signedInAs("u1", true);
    expect(await getActor()).toEqual({
      userId: "u1",
      role: "ADMIN",
      cooperativeId: null,
      twoFactorEnabled: true,
    });
  });

  it("ignores a cookie naming another user's membership", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    const theirs = await addMembership({
      userId: "u2",
      role: "FARMER",
      cooperativeId: "c1",
    });
    cookieGet.mockReturnValue({ value: theirs.id });
    signedInAs("u1");
    expect(await getActor()).toMatchObject({ userId: "u1", role: "BUYER" });
  });

  it("honours a cookie naming the user's own membership", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    const farmer = await addMembership({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c1",
    });
    cookieGet.mockReturnValue({ value: farmer.id });
    signedInAs("u1");
    expect(await getActor()).toMatchObject({
      role: "FARMER",
      cooperativeId: "c1",
      twoFactorEnabled: false,
    });
  });

  it("returns null for a user with only a PENDING membership", async () => {
    await addMembership({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c1",
      status: "PENDING",
    });
    signedInAs("u1");
    expect(await getActor()).toBeNull();
  });
});

describe("requireActor", () => {
  it("throws UnauthenticatedError when there is no actor", async () => {
    getSession.mockResolvedValue(null);
    await expect(requireActor()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
