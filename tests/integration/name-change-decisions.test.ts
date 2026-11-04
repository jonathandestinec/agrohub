import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import { approveLot, listLiveLots, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import {
  approveNameChange,
  getNameChangeDocumentUrl,
  getNameChangeForReview,
  getOwnNameChange,
  listNameChangeQueue,
  rejectNameChange,
  requestCooperativeRename,
  requestOwnNameChange,
  withdrawOwnNameChange,
} from "@/modules/name-changes/service";
import type { NameChangeFile } from "@/modules/name-changes/schema";
import { cleanDatabase, createTestUser } from "./helpers";
import { NOW, PHOTO, lotWorld, type LotWorld } from "./lot-fixtures";

const DAY = 86_400_000;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const affidavit: NameChangeFile = { kind: "AFFIDAVIT", body: PDF, contentType: "application/pdf" };
const certificate: NameChangeFile = {
  kind: "AMENDED_REGISTRATION_CERTIFICATE",
  body: PNG,
  contentType: "image/png",
};
const personInput = { newName: "Amina Musa", reason: "Married in October 2026" };

let world: LotWorld;
let since: Date;
let adminB: Actor;

async function adminUser(id: string): Promise<Actor> {
  await createTestUser({ id, name: `Admin ${id}` });
  await prisma.membership.create({ data: { userId: id, role: "ADMIN", status: "ACTIVE" } });
  return { userId: id, role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function personRequest(now = NOW) {
  return requestOwnNameChange({ userId: world.farmer.userId }, personInput, affidavit, now);
}

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  since = new Date();
  world = await lotWorld();
  await prisma.user.update({ where: { id: world.farmer.userId }, data: { name: "Amina Bello" } });
  await prisma.farmerProfile.update({
    where: { userId: world.farmer.userId },
    data: { accountName: "AMINA BELLO" },
  });
  await prisma.cooperative.update({
    where: { id: world.cooperativeId },
    data: { recipientCode: "RCP_coop", accountName: "ZARIA GROWERS COOP", bankName: "Test Bank" },
  });
  adminB = await adminUser("u-admin-b");
});

describe("approveNameChange", () => {
  it("approves_a_personal_name_change", async () => {
    const before = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: world.farmer.userId } });
    const request = await personRequest();
    const view = await approveNameChange(world.admin, request.id, NOW);
    expect(view.status).toBe("APPROVED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: world.farmer.userId } })).name).toBe(
      "Amina Musa",
    );
    const after = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: world.farmer.userId } });
    expect(after.recipientCode).toBe(before.recipientCode);
    expect(after.accountName).toBe(before.accountName);
    const audit = await prisma.auditLog.findMany({
      where: { action: "name_change.approve", createdAt: { gte: since } },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].meta)).not.toContain("Amina");
  });

  it("approves_a_cooperative_rename", async () => {
    const lot = await submitLot(world.farmer, world.input(), [PHOTO], NOW);
    await approveLot(world.officer, lot.id, { minOrderQty: 1 }, NOW);
    const before = await prisma.cooperative.findUniqueOrThrow({ where: { id: world.cooperativeId } });
    const request = await requestCooperativeRename(
      world.officer,
      world.cooperativeId,
      { newName: "Zaria Soy Growers", reason: "Members voted to add soy" },
      certificate,
      NOW,
    );
    await approveNameChange(world.admin, request.id, NOW);
    const after = await prisma.cooperative.findUniqueOrThrow({ where: { id: world.cooperativeId } });
    expect(after.name).toBe("Zaria Soy Growers");
    expect(after.recipientCode).toBe(before.recipientCode);
    expect(after.accountName).toBe(before.accountName);
    expect(after.bankName).toBe(before.bankName);
    expect(after.registrationNumber).toBe(before.registrationNumber);
    const live = await listLiveLots(NOW);
    expect(live.map((l) => l.cooperativeName)).toEqual(["Zaria Soy Growers"]);
  });

  it("refuses a request no longer pending, and non-admins", async () => {
    const request = await personRequest();
    await approveNameChange(world.admin, request.id, NOW);
    expect(await codeOf(approveNameChange(adminB, request.id, NOW))).toBe("NAME_CHANGE_NOT_PENDING");

    await prisma.user.update({ where: { id: world.farmer.userId }, data: { name: "Amina Bello" } });
    const second = await personRequest();
    await withdrawOwnNameChange({ userId: world.farmer.userId }, second.id, NOW);
    expect(await codeOf(approveNameChange(world.admin, second.id, NOW))).toBe("NAME_CHANGE_NOT_PENDING");

    const third = await personRequest();
    await expect(approveNameChange(world.officer, third.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveNameChange(world.farmer, third.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admin_cannot_decide_own_request", async () => {
    const request = await requestOwnNameChange(
      { userId: adminB.userId },
      { newName: "Ngozi Adeyemi", reason: "Married in September 2026" },
      { ...affidavit, kind: "MARRIAGE_CERTIFICATE" },
      NOW,
    );
    expect(await codeOf(approveNameChange(adminB, request.id, NOW))).toBe(
      "CANNOT_DECIDE_OWN_NAME_CHANGE",
    );
    expect(await codeOf(rejectNameChange(adminB, request.id, { reason: "Not mine to judge" }, NOW))).toBe(
      "CANNOT_DECIDE_OWN_NAME_CHANGE",
    );
    const queue = await listNameChangeQueue(adminB, NOW);
    expect(queue.find((r) => r.id === request.id)?.canDecide).toBe(false);
    expect((await listNameChangeQueue(world.admin, NOW)).find((r) => r.id === request.id)?.canDecide).toBe(
      true,
    );
    await approveNameChange(world.admin, request.id, NOW);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminB.userId } })).name).toBe(
      "Ngozi Adeyemi",
    );
  });

  it("admin_member_of_cooperative_cannot_decide", async () => {
    await prisma.membership.create({
      data: { userId: adminB.userId, role: "OFFICER", cooperativeId: world.cooperativeId, status: "ACTIVE" },
    });
    const request = await requestCooperativeRename(
      world.officer,
      world.cooperativeId,
      { newName: "Zaria Soy Growers", reason: "Members voted to add soy" },
      certificate,
      NOW,
    );
    expect(await codeOf(approveNameChange(adminB, request.id, NOW))).toBe(
      "CANNOT_DECIDE_OWN_NAME_CHANGE",
    );
    expect((await getNameChangeForReview(adminB, request.id, NOW)).canDecide).toBe(false);
    await approveNameChange(world.admin, request.id, NOW);
  });

  it("concurrent_decisions_have_one_winner", async () => {
    const request = await personRequest();
    const results = await Promise.allSettled([
      approveNameChange(world.admin, request.id, NOW),
      rejectNameChange(adminB, request.id, { reason: "Affidavit is unsigned" }, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("NAME_CHANGE_NOT_PENDING");
    const decisions = await prisma.auditLog.count({
      where: {
        action: { in: ["name_change.approve", "name_change.reject"] },
        createdAt: { gte: since },
      },
    });
    expect(decisions).toBe(1);
  });

  it("withdraw_during_approval_has_one_winner", async () => {
    const request = await personRequest();
    const [approved, withdrawn] = await Promise.allSettled([
      approveNameChange(world.admin, request.id, NOW),
      withdrawOwnNameChange({ userId: world.farmer.userId }, request.id, NOW),
    ]);
    expect([approved.status, withdrawn.status].filter((s) => s === "fulfilled")).toHaveLength(1);
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: world.farmer.userId } })).name;
    expect(name).toBe(withdrawn.status === "fulfilled" ? "Amina Bello" : "Amina Musa");
  });
});

describe("rejectNameChange", () => {
  it("rejects_with_a_reason", async () => {
    const request = await personRequest();
    expect(await codeOf(rejectNameChange(world.admin, request.id, { reason: "no" }, NOW))).toBe(
      "REASON_REQUIRED",
    );
    await rejectNameChange(world.admin, request.id, { reason: "Affidavit is unsigned" }, NOW);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: world.farmer.userId } })).name).toBe(
      "Amina Bello",
    );
    const own = await getOwnNameChange({ userId: world.farmer.userId });
    expect(own).toMatchObject({ status: "REJECTED", rejectionReason: "Affidavit is unsigned" });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "name_change.reject", createdAt: { gte: since } },
    });
    expect(JSON.stringify(audit.meta)).not.toContain("unsigned");
  });
});

describe("review data", () => {
  it("shows the payout account and whether it matches the new name", async () => {
    const request = await personRequest(new Date(NOW.getTime() - 3 * DAY));
    const review = await getNameChangeForReview(world.admin, request.id, NOW);
    expect(review).toMatchObject({
      payoutAccountName: "AMINA BELLO",
      newNameMatchesAccount: false,
      waitingDays: 3,
      reason: "Married in October 2026",
      requesterName: "Amina Bello",
      canDecide: true,
    });
    expect(review.subjectLabel).toContain("@example.com");
    const json = JSON.stringify(review);
    expect(json).not.toContain("name-changes/");
    expect(json).not.toContain("+234");
    expect(json).not.toContain("RCP_");
  });

  it("has no payout account for a person without a farmer profile", async () => {
    await createTestUser({ id: "u-buyer", name: "Chidi Okafor" });
    const request = await requestOwnNameChange(
      { userId: "u-buyer" },
      { newName: "Chidi Eze", reason: "Gazette notice published" },
      { ...affidavit, kind: "PUBLIC_NOTICE" },
      NOW,
    );
    const review = await getNameChangeForReview(world.admin, request.id, NOW);
    expect(review.payoutAccountName).toBeNull();
    expect(review.newNameMatchesAccount).toBeNull();
  });

  it("labels a cooperative request with its registration number", async () => {
    const request = await requestCooperativeRename(
      world.officer,
      world.cooperativeId,
      { newName: "Zaria Growers Cooperative", reason: "Registrar approved the new name" },
      certificate,
      NOW,
    );
    const coop = await prisma.cooperative.findUniqueOrThrow({ where: { id: world.cooperativeId } });
    const review = await getNameChangeForReview(world.admin, request.id, NOW);
    expect(review.subjectLabel).toBe(coop.registrationNumber);
    expect(review.payoutAccountName).toBe("ZARIA GROWERS COOP");
    expect(review.newNameMatchesAccount).toBe(true);
  });

  it("lists only pending requests, oldest first", async () => {
    const older = await personRequest(new Date(NOW.getTime() - 2 * DAY));
    await createTestUser({ id: "u-buyer", name: "Chidi Okafor" });
    const newer = await requestOwnNameChange(
      { userId: "u-buyer" },
      { newName: "Chidi Eze", reason: "Gazette notice published" },
      { ...affidavit, kind: "PUBLIC_NOTICE" },
      NOW,
    );
    expect((await listNameChangeQueue(world.admin, NOW)).map((r) => r.id)).toEqual([older.id, newer.id]);
    await approveNameChange(world.admin, older.id, NOW);
    expect((await listNameChangeQueue(world.admin, NOW)).map((r) => r.id)).toEqual([newer.id]);
    await expect(listNameChangeQueue(world.officer, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("opens the document through a signed link for admins only", async () => {
    const request = await personRequest();
    expect(typeof (await getNameChangeDocumentUrl(world.admin, request.id))).toBe("string");
    await expect(getNameChangeDocumentUrl(world.officer, request.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await codeOf(getNameChangeForReview(world.admin, "missing", NOW))).toBe(
      "NAME_CHANGE_NOT_FOUND",
    );
  });
});
