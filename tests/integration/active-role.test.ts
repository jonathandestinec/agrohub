import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  addMembership,
  getOwnedMembership,
  listMemberships,
} from "@/modules/identity/service";

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

beforeEach(async () => {
  await clean();
  await makeUser("u1");
  await makeUser("u2");
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("getOwnedMembership", () => {
  it("returns the user's own membership", async () => {
    const own = await addMembership({ userId: "u1", role: "BUYER" });
    const found = await getOwnedMembership("u1", own.id);
    expect(found.id).toBe(own.id);
  });

  it("rejects another user's membership", async () => {
    const theirs = await addMembership({ userId: "u2", role: "BUYER" });
    await expect(getOwnedMembership("u1", theirs.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects an unknown id", async () => {
    await expect(getOwnedMembership("u1", "nope")).rejects.toMatchObject({
      name: "ForbiddenError",
      code: "NOT_YOUR_MEMBERSHIP",
    });
  });
});

describe("listMemberships", () => {
  it("lists only the user's memberships", async () => {
    await addMembership({ userId: "u1", role: "BUYER" });
    await addMembership({ userId: "u2", role: "BUYER" });
    const list = await listMemberships("u1");
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe("u1");
  });
});
