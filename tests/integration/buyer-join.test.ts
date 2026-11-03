import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addMembership, becomeBuyer } from "@/modules/identity/service";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

async function verifiedUser(): Promise<string> {
  const user = await createTestUser();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  return user.id;
}

describe("becomeBuyer", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  it("gives a verified user an ACTIVE buyer membership and leaves the phone unconfirmed", async () => {
    const userId = await verifiedUser();
    const since = new Date();
    const { membershipId } = await becomeBuyer({ userId });

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(membership).toMatchObject({ userId, role: "BUYER", status: "ACTIVE", cooperativeId: null });
    const audits = await prisma.auditLog.findMany({
      where: { action: "buyer.join", createdAt: { gte: since } },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toEqual({ membershipId });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phoneConfirmed).toBe(false);
  });

  it("returns the same membership when called again and writes no second audit row", async () => {
    const userId = await verifiedUser();
    const first = await becomeBuyer({ userId });
    const since = new Date();
    const second = await becomeBuyer({ userId });
    expect(second.membershipId).toBe(first.membershipId);
    expect(await prisma.membership.count({ where: { userId, role: "BUYER" } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "buyer.join", createdAt: { gte: since } } }),
    ).toBe(0);
  });

  it("refuses a user whose email is not verified", async () => {
    const user = await createTestUser();
    await expect(becomeBuyer({ userId: user.id })).rejects.toThrow(ForbiddenError);
    await expect(becomeBuyer({ userId: user.id })).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
  });

  it("lets an active farmer also become a buyer", async () => {
    const userId = await verifiedUser();
    const coop = await createTestCooperative({ status: "VERIFIED" });
    await addMembership({ userId, role: "FARMER", cooperativeId: coop.id });
    await becomeBuyer({ userId });
    const roles = (await prisma.membership.findMany({ where: { userId, status: "ACTIVE" } })).map(
      (m) => m.role,
    );
    expect(roles.sort()).toEqual(["BUYER", "FARMER"]);
  });
});
