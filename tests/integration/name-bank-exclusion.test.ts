import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack, resetBankCacheForTests } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { confirmBankChange, setOwnFarmerBankAccount } from "@/modules/banking/service";
import type { Actor } from "@/modules/identity/policies";
import { approveNameChange, requestOwnNameChange } from "@/modules/name-changes/service";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

// The two-way rule between name changes and bank changes must hold when both are asked for
// at the same moment, not only when they come one after the other.

const HOUR = 3_600_000;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const affidavit = { kind: "AFFIDAVIT" as const, body: PDF, contentType: "application/pdf" };
const input = { newName: "Amina Musa", reason: "Married in October 2026" };
const OLD = "5555555555";
const NEW = "6666666666";

let coopId: string;
const admin: Actor = { userId: "u-admin", role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };

async function farmer(id: string): Promise<{ userId: string; profileId: string }> {
  await createTestUser({ id, name: "Amina Bello" });
  await prisma.membership.create({ data: { userId: id, role: "FARMER", cooperativeId: coopId, status: "ACTIVE" } });
  const profile = await prisma.farmerProfile.create({
    data: { userId: id, cooperativeId: coopId, farmSizeHectares: "1", state: "Kaduna", lga: "Zaria" },
  });
  await setOwnFarmerBankAccount({ userId: id }, { accountNumber: OLD, bankCode: "058" });
  return { userId: id, profileId: profile.id };
}

async function openBankChange(profileId: string): Promise<boolean> {
  const now = new Date();
  const open = await prisma.bankChangeRequest.findFirst({
    where: {
      ownerType: "FARMER",
      ownerId: profileId,
      cancelledAt: null,
      appliedAt: null,
      OR: [
        { confirmedAt: null, createdAt: { gt: new Date(now.getTime() - 24 * HOUR) } },
        { confirmedAt: { not: null }, effectiveAt: { gt: now } },
      ],
    },
  });
  return open !== null;
}

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  resetBankCacheForTests();
  fakePaystack.accounts.set(`058:${OLD}`, "AMINA BELLO");
  fakePaystack.accounts.set(`044:${NEW}`, "AMINA BELLO");
  coopId = (await createTestCooperative({ status: "VERIFIED" })).id;
  await createTestUser({ id: "u-admin" });
});

describe("name change and bank change asked for at once", () => {
  it("never leaves a pending name change beside an open bank change", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { userId, profileId } = await farmer(`u-race-${round}`);
      await Promise.allSettled([
        requestOwnNameChange({ userId }, input, affidavit),
        setOwnFarmerBankAccount({ userId }, { accountNumber: NEW, bankCode: "044" }),
      ]);
      const pendingName = await prisma.nameChangeRequest.count({
        where: { subjectType: "USER", subjectId: userId, status: "PENDING" },
      });
      expect({ round, both: pendingName === 1 && (await openBankChange(profileId)) }).toEqual({
        round,
        both: false,
      });
    }
  });
});

describe("approveNameChange", () => {
  it("refuses while a bank change is inside its 48 hours", async () => {
    const { userId, profileId } = await farmer("u-amina");
    const request = await requestOwnNameChange({ userId }, input, affidavit);
    // A confirmed change slipped in beside the request (the case the lock prevents).
    await prisma.bankChangeRequest.create({
      data: {
        ownerType: "FARMER",
        ownerId: profileId,
        newRecipientCode: "RCP_new",
        newAccountName: "AMINA BELLO",
        newBankName: "Access Bank",
        requestedBy: userId,
        confirmToken: "tok-open",
        createdAt: new Date(Date.now() - HOUR),
        confirmedAt: new Date(Date.now() - HOUR),
        effectiveAt: new Date(Date.now() + 47 * HOUR),
      },
    });
    await expect(approveNameChange(admin, request.id)).rejects.toMatchObject({ code: "BANK_CHANGE_OPEN" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe("Amina Bello");
    expect((await prisma.nameChangeRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "PENDING",
    );
  });
});

describe("confirmBankChange", () => {
  it("says the link is invalid, not that a name change waits, for an expired token", async () => {
    const { userId, profileId } = await farmer("u-amina");
    await prisma.bankChangeRequest.create({
      data: {
        ownerType: "FARMER",
        ownerId: profileId,
        newRecipientCode: "RCP_new",
        newAccountName: "AMINA BELLO",
        newBankName: "Access Bank",
        requestedBy: userId,
        confirmToken: "tok-expired",
        createdAt: new Date(Date.now() - 30 * HOUR),
      },
    });
    await prisma.nameChangeRequest.create({
      data: {
        subjectType: "USER",
        subjectId: userId,
        fromName: "Amina Bello",
        toName: "Amina Musa",
        reason: "Married in October 2026",
        documentKind: "AFFIDAVIT",
        storageKey: "name-changes/test",
        contentType: "application/pdf",
        sizeBytes: 10,
        requestedByUserId: userId,
      },
    });
    await expect(confirmBankChange("tok-expired")).rejects.toMatchObject({ code: "BANK_CHANGE_INVALID" });
  });
});
