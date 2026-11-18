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

// This membership's join rows. Not "rows since a timestamp": audit_log is append-only (never
// cleaned) and createdAt is TIMESTAMP(3), which rounds, so a row written just before
// `new Date()` (which truncates) could be stored as later and counted. That made the
// "no second audit row" test fail now and then in CI.
function joinAuditsOf(membershipId: string) {
  return { action: "buyer.join", entity: "membership", entityId: membershipId };
}

describe("becomeBuyer", () => {
  beforeEach(cleanDatabase);
  afterAll(cleanDatabase);

  it("gives a verified user an ACTIVE buyer membership and leaves the phone unconfirmed", async () => {
    const userId = await verifiedUser();
    const { membershipId } = await becomeBuyer({ userId });

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(membership).toMatchObject({ userId, role: "BUYER", status: "ACTIVE", cooperativeId: null });
    const audits = await prisma.auditLog.findMany({ where: joinAuditsOf(membershipId) });
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toEqual({ membershipId });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phoneConfirmed).toBe(false);
  });

  it("returns the same membership when called again and writes no second audit row", async () => {
    const userId = await verifiedUser();
    const first = await becomeBuyer({ userId });
    const second = await becomeBuyer({ userId });
    expect(second.membershipId).toBe(first.membershipId);
    expect(await prisma.membership.count({ where: { userId, role: "BUYER" } })).toBe(1);
    // Only the first call's row: the second call writes none.
    expect(await prisma.auditLog.count({ where: joinAuditsOf(first.membershipId) })).toBe(1);
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
