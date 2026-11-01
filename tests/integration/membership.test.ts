import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
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

beforeEach(async () => {
  await clean();
  await makeUser("u1");
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("addMembership", () => {
  it("lets a farmer whose FARMER membership is LEFT join another cooperative", async () => {
    await addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c1" });
    await prisma.membership.updateMany({
      where: { userId: "u1", role: "FARMER" },
      data: { status: "LEFT" },
    });
    const next = await addMembership({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c2",
    });
    expect(next).toMatchObject({ cooperativeId: "c2", status: "ACTIVE" });
  });

  it("rejects a second PENDING FARMER membership", async () => {
    await addMembership({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c1",
      status: "PENDING",
    });
    await expect(
      addMembership({
        userId: "u1",
        role: "FARMER",
        cooperativeId: "c2",
        status: "PENDING",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("writes exactly one membership.grant audit row", async () => {
    const m = await addMembership({ userId: "u1", role: "BUYER" });
    const rows = await prisma.auditLog.findMany({
      where: { entityId: m.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "membership.grant",
      entity: "membership",
      actorId: null,
      meta: { role: "BUYER", status: "ACTIVE" },
    });
  });

  it("creates a membership", async () => {
    const m = await addMembership({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c1",
    });
    expect(m).toMatchObject({
      userId: "u1",
      role: "FARMER",
      cooperativeId: "c1",
    });
  });

  it("rejects a second FARMER membership, even in another cooperative", async () => {
    await addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c1" });
    await expect(
      addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c2" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a duplicate (userId, role, cooperativeId)", async () => {
    await addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c1" });
    await expect(
      addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c1" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a duplicate ADMIN membership with a null cooperative", async () => {
    await addMembership({ userId: "u1", role: "ADMIN" });
    await expect(
      addMembership({ userId: "u1", role: "ADMIN" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a second OFFICER membership in another cooperative", async () => {
    await addMembership({ userId: "u1", role: "OFFICER", cooperativeId: "c1" });
    await expect(
      addMembership({ userId: "u1", role: "OFFICER", cooperativeId: "c2" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets one user hold FARMER and BUYER", async () => {
    await addMembership({ userId: "u1", role: "FARMER", cooperativeId: "c1" });
    const buyer = await addMembership({ userId: "u1", role: "BUYER" });
    expect(buyer.role).toBe("BUYER");
    expect(await prisma.membership.count({ where: { userId: "u1" } })).toBe(2);
  });

  it.each(["FARMER", "OFFICER"] as const)(
    "requires a cooperativeId for %s",
    async (role) => {
      await expect(
        addMembership({ userId: "u1", role }),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it.each(["BUYER", "ADMIN", "BOARD_ADMIN"] as const)(
    "forbids a cooperativeId for %s",
    async (role) => {
      await expect(
        addMembership({ userId: "u1", role, cooperativeId: "c1" }),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it("does not map other database errors to ConflictError", async () => {
    // Unknown user -> foreign key violation, not a conflict.
    const error = await addMembership({
      userId: "missing",
      role: "BUYER",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConflictError);
  });
});
