import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { fakePaystack, resetBankCacheForTests } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import {
  applyDueBankChanges,
  confirmBankChange,
  setCooperativeBankAccount,
  setOwnFarmerBankAccount,
} from "@/modules/banking/service";
import { runCertificateExpiry } from "@/modules/cooperatives/expiry";
import {
  reinstateCooperative,
  rejectCooperative,
  suspendCooperative,
  uploadDocument,
  verifyCooperative,
} from "@/modules/cooperatives/service";
import { approveFarmer, joinViaLink, leaveCooperative, rejectFarmer, removeFarmer } from "@/modules/farmers/service";
import {
  approveNameChange,
  rejectNameChange,
  requestCooperativeRename,
  requestOwnNameChange,
} from "@/modules/name-changes/service";
import { latestOwnAlerts } from "@/modules/notifications/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, officerMember, type LotWorld } from "./lot-fixtures";

const DAY = 86_400_000;
const PDF = { body: Buffer.from("%PDF-1.7 test body"), contentType: "application/pdf" };
const PNG = {
  body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  contentType: "image/png",
};
const PROFILE = { farmSizeHectares: "2.5", cropIds: [], state: "Ogun", lga: "Abeokuta North" };

let w: LotWorld;
const clearAlerts = () => prisma.notification.deleteMany();

beforeEach(async () => {
  await cleanDatabase();
  await prisma.jobRun.deleteMany();
  fakeStorage.clear();
  fakeOutbox.clear();
  fakePaystack.clear();
  resetBankCacheForTests();
  w = await lotWorld();
  // lotWorld gives the admin no membership row, and alerts go to membership holders.
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
  await clearAlerts();
});

afterAll(cleanDatabase);

async function newJoiner(id: string, name: string) {
  await createTestUser({ id, name });
  await prisma.inviteLink.create({
    data: { cooperativeId: w.cooperativeId, token: `tok-${id}`, createdBy: w.officer.userId },
  });
  const { membershipId } = await joinViaLink({ userId: id }, `tok-${id}`, PROFILE, NOW);
  return membershipId;
}

describe("membership alerts", () => {
  it("tells_officers_a_farmer_asked_to_join", async () => {
    await newJoiner("u-joy", "Joy Okoro");
    expect(await alertKinds(w.officer.userId)).toEqual(["FARMER_ASKED_TO_JOIN"]);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { role: "OFFICER", cooperativeId: w.cooperativeId, subjectType: "MEMBERSHIP", data: { name: "Joy Okoro" } },
    ]);
    expect(await alertKinds("u-joy")).toEqual([]);
  });

  it("tells_the_farmer_they_were_approved", async () => {
    const id = await newJoiner("u-joy", "Joy Okoro");
    await clearAlerts();
    await approveFarmer(w.officer, id, NOW);
    expect(await alertsFor("u-joy")).toMatchObject([
      { kind: "MEMBERSHIP_APPROVED", role: null, cooperativeId: null, subjectId: id, data: { cooperative: "Zaria Growers" } },
    ]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
  });

  it("tells_the_farmer_they_were_rejected", async () => {
    const id = await newJoiner("u-joy", "Joy Okoro");
    await clearAlerts();
    await rejectFarmer(w.officer, id, "We do not know you");
    expect(await alertKinds("u-joy")).toEqual(["MEMBERSHIP_REJECTED"]);
  });

  it("tells_the_farmer_they_were_removed", async () => {
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: w.farmer.userId, role: "FARMER" } });
    await removeFarmer(w.officer, membership.id, "Left the area");
    expect(await alertKinds(w.farmer.userId)).toEqual(["MEMBERSHIP_REMOVED"]);
  });

  it("a_removed_farmer_sees_the_alert_under_another_role", async () => {
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId: w.farmer.userId, role: "FARMER" } });
    await removeFarmer(w.officer, membership.id, "Left the area");
    const asBuyer = await buyerMember(w.farmer.userId);
    expect((await latestOwnAlerts(asBuyer)).map((a) => a.kind)).toContain("MEMBERSHIP_REMOVED");
  });

  it("tells_officers_a_farmer_left", async () => {
    await leaveCooperative(w.farmer);
    expect(await alertKinds(w.officer.userId)).toEqual(["FARMER_LEFT"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it("a_refused_change_writes_no_alert", async () => {
    const id = await newJoiner("u-joy", "Joy Okoro");
    await approveFarmer(w.officer, id, NOW);
    const before = await prisma.notification.count();
    await expect(approveFarmer(w.officer, id, NOW)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(before);
  });
});

describe("cooperative alerts", () => {
  // A pending cooperative with its own officer, ready for its last document.
  async function pendingCoop() {
    const coop = await createTestCooperative({
      name: "Kano Growers",
      status: "PENDING",
      certificateExpiresAt: new Date("2040-01-01"),
    });
    const officer = await officerMember("u-officer-k", coop.id);
    const upload = (kind: "REGISTRATION_CERTIFICATE" | "BYLAWS" | "OFFICER_LIST") =>
      uploadDocument(
        officer,
        coop.id,
        { kind, ...PDF, ...(kind === "REGISTRATION_CERTIFICATE" ? { certificateExpiresAt: new Date("2040-01-01") } : {}) },
        NOW,
      );
    return { coop, officer, upload };
  }

  it("tells_admins_a_cooperative_is_ready_to_verify_once", async () => {
    const { coop, upload } = await pendingCoop();
    await upload("REGISTRATION_CERTIFICATE");
    await upload("BYLAWS");
    expect(await alertKinds(w.admin.userId)).toEqual([]);
    await upload("OFFICER_LIST");
    await upload("OFFICER_LIST");
    expect(await alertsFor(w.admin.userId)).toMatchObject([
      { kind: "COOPERATIVE_SUBMITTED", role: "ADMIN", subjectType: "COOPERATIVE", subjectId: coop.id, data: { cooperative: "Kano Growers" } },
    ]);
  });

  it.each([
    ["verified", "COOPERATIVE_VERIFIED"],
    ["rejected", "COOPERATIVE_REJECTED"],
  ] as const)("tells_officers_the_cooperative_was_%s", async (_name, kind) => {
    const { coop, upload } = await pendingCoop();
    for (const k of ["REGISTRATION_CERTIFICATE", "BYLAWS", "OFFICER_LIST"] as const) await upload(k);
    await clearAlerts();
    if (kind === "COOPERATIVE_VERIFIED") await verifyCooperative(w.admin, coop.id, NOW);
    else await rejectCooperative(w.admin, coop.id, "Documents are unclear", NOW);
    expect(await alertKinds("u-officer-k")).toEqual([kind]);
    expect(await alertKinds(w.admin.userId)).toEqual([]);
  });

  it("tells_officers_a_cooperative_was_suspended_then_reinstated", async () => {
    await prisma.cooperative.update({ where: { id: w.cooperativeId }, data: { certificateExpiresAt: new Date("2040-01-01") } });
    await suspendCooperative(w.admin, w.cooperativeId, "Complaints received", NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["COOPERATIVE_SUSPENDED"]);
    await reinstateCooperative(w.admin, w.cooperativeId, NOW);
    expect((await alertKinds(w.officer.userId)).sort()).toEqual(["COOPERATIVE_REINSTATED", "COOPERATIVE_SUSPENDED"]);
    expect(await alertKinds(w.admin.userId)).toEqual([]);
  });

  it("tells_officers_a_certificate_is_expiring_once_per_date", async () => {
    await prisma.cooperative.update({
      where: { id: w.cooperativeId },
      data: { certificateExpiresAt: new Date(NOW.getTime() + 10 * DAY) },
    });
    await runCertificateExpiry(NOW);
    await runCertificateExpiry(NOW);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { kind: "CERTIFICATE_EXPIRING", role: "OFFICER", subjectType: "COOPERATIVE", subjectId: w.cooperativeId },
    ]);
  });

  it("tells_officers_a_certificate_expired_once", async () => {
    await prisma.cooperative.update({
      where: { id: w.cooperativeId },
      data: { certificateExpiresAt: new Date(NOW.getTime() - DAY) },
    });
    await runCertificateExpiry(NOW);
    await runCertificateExpiry(NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["CERTIFICATE_EXPIRED"]);
  });
});

describe("name change alerts", () => {
  const affidavit = { kind: "AFFIDAVIT" as const, ...PDF };
  const personInput = { newName: "Amina Musa", reason: "Married in October 2026" };
  const coopInput = { newName: "Zaria Maize Growers", reason: "We changed our registered name" };
  const certificate = { kind: "AMENDED_REGISTRATION_CERTIFICATE" as const, ...PNG };
  const requestOf = () => prisma.nameChangeRequest.findFirstOrThrow();

  it("tells_admins_a_name_change_is_waiting", async () => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    await requestCooperativeRename(w.officer, w.cooperativeId, coopInput, certificate, NOW);
    const rows = await alertsFor(w.admin.userId);
    expect(rows.map((r) => r.kind)).toEqual(["NAME_CHANGE_REQUESTED", "NAME_CHANGE_REQUESTED"]);
    expect(rows[0]).toMatchObject({ role: "ADMIN", subjectType: "NAME_CHANGE", data: {} });
  });

  it.each([
    ["approved", "NAME_CHANGE_APPROVED"],
    ["rejected", "NAME_CHANGE_REJECTED"],
  ] as const)("tells_the_person_their_name_change_was_%s", async (_name, kind) => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    const request = await requestOf();
    await clearAlerts();
    if (kind === "NAME_CHANGE_APPROVED") await approveNameChange(w.admin, request.id, NOW);
    else await rejectNameChange(w.admin, request.id, { reason: "The document is unclear" }, NOW);
    expect(await alertsFor(w.farmer.userId)).toMatchObject([
      { kind, role: null, cooperativeId: null, subjectType: "NAME_CHANGE", subjectId: request.id },
    ]);
    expect(await alertKinds(w.admin.userId)).toEqual([]);
  });

  it("tells_officers_their_rename_was_decided", async () => {
    await requestCooperativeRename(w.officer, w.cooperativeId, coopInput, certificate, NOW);
    const request = await requestOf();
    await clearAlerts();
    await approveNameChange(w.admin, request.id, NOW);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { kind: "NAME_CHANGE_APPROVED", role: "OFFICER", cooperativeId: w.cooperativeId },
    ]);
  });
});

describe("bank change alerts", () => {
  const T = new Date("2031-06-10T12:00:00Z");
  const OLD = "0123456789";
  const NEW = "9876543210";

  async function pendingCooperativeChange() {
    fakePaystack.accounts.set(`058:${OLD}`, "ZARIA GROWERS");
    fakePaystack.accounts.set(`044:${NEW}`, "ZARIA GROWERS");
    await setCooperativeBankAccount(w.officer, w.cooperativeId, { accountNumber: OLD, bankCode: "058" }, T);
    await setCooperativeBankAccount(w.officer, w.cooperativeId, { accountNumber: NEW, bankCode: "044" }, T);
    return prisma.bankChangeRequest.findFirstOrThrow({
      where: { ownerId: w.cooperativeId, cancelledAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  it("tells_admins_bank_details_were_confirmed", async () => {
    const request = await pendingCooperativeChange();
    await clearAlerts();
    await confirmBankChange(request.confirmToken, T);
    expect(await alertsFor(w.admin.userId)).toMatchObject([
      { kind: "BANK_CHANGE_CONFIRMED", role: "ADMIN", subjectType: "BANK_CHANGE", subjectId: request.id, data: {} },
    ]);
    // A repeated click on the same link changes nothing and alerts no one again.
    await expect(confirmBankChange(request.confirmToken, T)).rejects.toThrow();
    expect(await alertKinds(w.admin.userId)).toEqual(["BANK_CHANGE_CONFIRMED"]);
  });

  it("tells_officers_new_bank_details_took_effect_once", async () => {
    const request = await pendingCooperativeChange();
    await confirmBankChange(request.confirmToken, T);
    await clearAlerts();
    const later = new Date(T.getTime() + 49 * 3_600_000);
    await applyDueBankChanges(later);
    await applyDueBankChanges(later);
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { kind: "BANK_CHANGE_APPLIED", role: "OFFICER", cooperativeId: w.cooperativeId, subjectType: "BANK_CHANGE", data: {} },
    ]);
  });

  it("tells_the_farmer_new_bank_details_took_effect_once", async () => {
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: w.farmer.userId } })).name.toUpperCase();
    fakePaystack.accounts.set(`058:${OLD}`, name);
    fakePaystack.accounts.set(`044:${NEW}`, name);
    await setOwnFarmerBankAccount({ userId: w.farmer.userId }, { accountNumber: OLD, bankCode: "058" }, T);
    await setOwnFarmerBankAccount({ userId: w.farmer.userId }, { accountNumber: NEW, bankCode: "044" }, T);
    const request = await prisma.bankChangeRequest.findFirstOrThrow({
      where: { ownerType: "FARMER", cancelledAt: null },
      orderBy: { createdAt: "desc" },
    });
    await confirmBankChange(request.confirmToken, T);
    await clearAlerts();
    const later = new Date(T.getTime() + 49 * 3_600_000);
    await applyDueBankChanges(later);
    await applyDueBankChanges(later);
    expect(await alertsFor(w.farmer.userId)).toMatchObject([
      { kind: "BANK_CHANGE_APPLIED", role: null, cooperativeId: null, subjectId: request.id },
    ]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
  });
});

// Keeps the fixtures that only some tests above use from looking unused to the linter.
void farmerMember;
