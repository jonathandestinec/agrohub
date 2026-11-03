import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakeOutbox, sendEmail } from "@/lib/email";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getJob } from "@/lib/jobs/registry";
import "@/lib/jobs";
import { fakePaystack, resetBankCacheForTests } from "@/lib/paystack";
import {
  applyDueBankChanges,
  confirmBankChange,
  effectiveRecipientCode,
  getCooperativeBankAccount,
  getOwnFarmerBankAccount,
  previewCooperativeBankAccount,
  previewOwnFarmerBankAccount,
  setCooperativeBankAccount,
  setOwnFarmerBankAccount,
} from "@/modules/banking/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const HOUR = 3_600_000;
const T = new Date("2031-06-10T12:00:00Z");
const OLD_ACCOUNT = "0123456789";
const NEW_ACCOUNT = "9876543210";
const COOP_NAME = "Ogun Farmers Cooperative Society";

let cooperativeId: string;
let officer: Actor;

async function setUpCooperative() {
  const coop = await createTestCooperative({ name: COOP_NAME });
  cooperativeId = coop.id;
  const user = await createTestUser({ id: "u-officer", email: "officer@example.com" });
  await prisma.membership.create({
    data: { userId: user.id, role: "OFFICER", cooperativeId, status: "ACTIVE" },
  });
  officer = { userId: user.id, role: "OFFICER", cooperativeId, twoFactorEnabled: true };
}

async function addAdmin(id: string, status: "ACTIVE" | "REMOVED" = "ACTIVE") {
  await createTestUser({ id, email: `${id}@example.com` });
  await prisma.membership.create({ data: { userId: id, role: "ADMIN", status } });
}

const owner = () => ({ type: "COOPERATIVE" as const, id: cooperativeId });

async function firstThenSecond() {
  await setCooperativeBankAccount(officer, cooperativeId, { accountNumber: OLD_ACCOUNT, bankCode: "058" }, T);
  const oldCode = fakePaystack.recipients[0];
  fakeOutbox.clear();
  const second = await setCooperativeBankAccount(
    officer,
    cooperativeId,
    { accountNumber: NEW_ACCOUNT, bankCode: "044" },
    T,
  );
  const request = await prisma.bankChangeRequest.findFirstOrThrow({
    where: { ownerId: cooperativeId, cancelledAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { oldCode, newCode: fakePaystack.recipients[1], second, request };
}

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
  fakePaystack.clear();
  resetBankCacheForTests();
  fakePaystack.accounts.set(`058:${OLD_ACCOUNT}`, "OGUN FARMERS COOP SOC");
  fakePaystack.accounts.set(`044:${NEW_ACCOUNT}`, "OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD");
  await setUpCooperative();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("previewCooperativeBankAccount", () => {
  it("shows the bank's name for the account and whether it matches, storing nothing", async () => {
    fakePaystack.accounts.set("057:3333333333", "LAGOS TRADERS LTD");
    await expect(
      previewCooperativeBankAccount(officer, cooperativeId, { accountNumber: OLD_ACCOUNT, bankCode: "058" }),
    ).resolves.toEqual({ accountName: "OGUN FARMERS COOP SOC", matches: true, registeredName: COOP_NAME });
    await expect(
      previewCooperativeBankAccount(officer, cooperativeId, { accountNumber: "3333333333", bankCode: "057" }),
    ).resolves.toEqual({ accountName: "LAGOS TRADERS LTD", matches: false, registeredName: COOP_NAME });
    expect(fakePaystack.recipients).toEqual([]);
    expect(await prisma.bankChangeRequest.count()).toBe(0);
  });

  it("needs the same permission as changing the account", async () => {
    await expect(
      previewCooperativeBankAccount({ ...officer, twoFactorEnabled: false }, cooperativeId, {
        accountNumber: OLD_ACCOUNT,
        bankCode: "058",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("setCooperativeBankAccount", () => {
  it("sets the first account immediately", async () => {
    const result = await setCooperativeBankAccount(
      officer,
      cooperativeId,
      { accountNumber: OLD_ACCOUNT, bankCode: "058" },
      T,
    );
    expect(result).toEqual({ accountName: "OGUN FARMERS COOP SOC", pending: false });
    const coop = await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperativeId } });
    expect(coop.recipientCode).toBe(fakePaystack.recipients[0]);
    expect(coop.accountName).toBe("OGUN FARMERS COOP SOC");
    expect(coop.bankName).toBe("Guaranty Trust Bank");
    expect(await prisma.bankChangeRequest.count()).toBe(0);
  });

  it("makes a second account pending and emails the requesting officer a link", async () => {
    const { second, request } = await firstThenSecond();
    expect(second).toEqual({
      accountName: "OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD",
      pending: true,
    });
    expect(request.confirmToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.newBankName).toBe("Access Bank");
    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].to).toBe("officer@example.com");
    expect(fakeOutbox.sent[0].html).toContain(`/bank/confirm?token=${request.confirmToken}`);
    expect(fakeOutbox.sent[0].html).not.toContain(NEW_ACCOUNT);
  });

  it("keeps the old code before confirmation", async () => {
    const { oldCode } = await firstThenSecond();
    expect(await effectiveRecipientCode(owner(), new Date(T.getTime() + 100 * HOUR))).toBe(oldCode);
  });

  it("cancels an older unconfirmed request when a newer one is made", async () => {
    const { request } = await firstThenSecond();
    await setCooperativeBankAccount(officer, cooperativeId, { accountNumber: NEW_ACCOUNT, bankCode: "044" }, T);
    const older = await prisma.bankChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(older.cancelledAt).not.toBeNull();
    await expect(confirmBankChange(request.confirmToken, T)).rejects.toMatchObject({
      code: "BANK_CHANGE_INVALID",
    });
  });

  it("forbids an OFFICER without two-factor", async () => {
    await expect(
      setCooperativeBankAccount(
        { ...officer, twoFactorEnabled: false },
        cooperativeId,
        { accountNumber: OLD_ACCOUNT, bankCode: "058" },
        T,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids an officer of another cooperative", async () => {
    const other = await createTestCooperative();
    await expect(
      setCooperativeBankAccount(officer, other.id, { accountNumber: OLD_ACCOUNT, bankCode: "058" }, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a name mismatch with ACCOUNT_NAME_MISMATCH", async () => {
    fakePaystack.accounts.set(`058:${OLD_ACCOUNT}`, "ADA OKAFOR");
    await expect(
      setCooperativeBankAccount(officer, cooperativeId, { accountNumber: OLD_ACCOUNT, bankCode: "058" }, T),
    ).rejects.toMatchObject({ code: "ACCOUNT_NAME_MISMATCH" });
    expect(fakePaystack.recipients).toHaveLength(0);
  });

  it("rejects an unknown bank code with UNKNOWN_BANK", async () => {
    await expect(
      setCooperativeBankAccount(officer, cooperativeId, { accountNumber: OLD_ACCOUNT, bankCode: "999" }, T),
    ).rejects.toMatchObject({ code: "UNKNOWN_BANK" });
  });

  it("rejects a malformed account number and never echoes it", async () => {
    const bad = "12345";
    const error = await setCooperativeBankAccount(
      officer,
      cooperativeId,
      { accountNumber: bad, bankCode: "058" },
      T,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).not.toContain(bad);
  });

  it("maps an unknown account to BANK_ACCOUNT_NOT_FOUND", async () => {
    fakePaystack.accounts.clear();
    await expect(
      setCooperativeBankAccount(officer, cooperativeId, { accountNumber: OLD_ACCOUNT, bankCode: "058" }, T),
    ).rejects.toMatchObject({ code: "BANK_ACCOUNT_NOT_FOUND" });
  });

  it("never stores, audits or logs the account number", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const { request } = await firstThenSecond();
      await confirmBankChange(request.confirmToken, T);
      await applyDueBankChanges(new Date(T.getTime() + 48 * HOUR));
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>(
        Prisma.sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_change_request'`,
      );
      const names = columns.map((c) => c.column_name.toLowerCase());
      expect(names.length).toBeGreaterThan(0);
      expect(names.some((n) => n.includes("account_number") || n.includes("accountnumber"))).toBe(false);
      const rows = JSON.stringify(await prisma.bankChangeRequest.findMany());
      const coop = JSON.stringify(await prisma.cooperative.findMany());
      const audit = JSON.stringify(await prisma.auditLog.findMany());
      for (const text of [rows, coop, audit, JSON.stringify(spies.flatMap((s) => s.mock.calls))]) {
        expect(text).not.toContain(OLD_ACCOUNT);
        expect(text).not.toContain(NEW_ACCOUNT);
      }
      for (const email of fakeOutbox.sent) {
        expect(email.html).not.toContain(NEW_ACCOUNT);
        expect(email.subject).not.toContain(NEW_ACCOUNT);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("confirmBankChange", () => {
  it("bank_change_takes_effect_after_48_hours", async () => {
    const { oldCode, newCode, request } = await firstThenSecond();
    const { effectiveAt } = await confirmBankChange(request.confirmToken, T);
    expect(effectiveAt.toISOString()).toBe(new Date(T.getTime() + 48 * HOUR).toISOString());
    const justBefore = new Date(T.getTime() + 47 * HOUR + 59 * 60_000);
    expect(await effectiveRecipientCode(owner(), justBefore)).toBe(oldCode);
    expect(await effectiveRecipientCode(owner(), new Date(T.getTime() + 48 * HOUR))).toBe(newCode);
  });

  it("emails one alert per ACTIVE admin and writes the audit row", async () => {
    await addAdmin("u-admin-1");
    await addAdmin("u-admin-2");
    await addAdmin("u-admin-gone", "REMOVED");
    const { request } = await firstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    const toAdmins = fakeOutbox.sent.filter((m) => m.to.startsWith("u-admin"));
    expect(toAdmins.map((m) => m.to).sort()).toEqual([
      "u-admin-1@example.com",
      "u-admin-2@example.com",
    ]);
    for (const mail of toAdmins) {
      expect(mail.html).toContain("OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD");
      expect(mail.html).not.toContain(NEW_ACCOUNT);
      expect(`${mail.subject} ${mail.html}`).not.toMatch(/escrow/i);
    }
    const audit = await prisma.auditLog.findMany({ where: { action: "bank.change.confirmed", entityId: request.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(officer.userId);
  });

  it("logs a failed admin email without the address and still confirms", async () => {
    await addAdmin("u-admin-1");
    const { request } = await firstThenSecond();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await confirmBankChange(request.confirmToken, T);
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain("@example.com");
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.bankChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.confirmedAt).not.toBeNull();
  });

  it("is single-use", async () => {
    const { request } = await firstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    await expect(confirmBankChange(request.confirmToken, T)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects an unknown token", async () => {
    await expect(confirmBankChange("nope", T)).rejects.toMatchObject({ code: "BANK_CHANGE_INVALID" });
    await expect(confirmBankChange("", T)).rejects.toMatchObject({ code: "BANK_CHANGE_INVALID" });
  });

  it("expires a request not confirmed within 24 hours", async () => {
    const { request } = await firstThenSecond();
    await expect(
      confirmBankChange(request.confirmToken, new Date(T.getTime() + 24 * HOUR)),
    ).rejects.toMatchObject({ code: "BANK_CHANGE_INVALID" });
    const ok = await firstThenSecond();
    await expect(
      confirmBankChange(ok.request.confirmToken, new Date(T.getTime() + 24 * HOUR - 1)),
    ).resolves.toBeDefined();
  });
});

describe("applyDueBankChanges", () => {
  it("copies the due request onto the cooperative once", async () => {
    const { newCode, request } = await firstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    expect(await applyDueBankChanges(new Date(T.getTime() + 47 * HOUR))).toEqual({ applied: 0 });
    const due = new Date(T.getTime() + 48 * HOUR);
    expect(await applyDueBankChanges(due)).toEqual({ applied: 1 });
    expect(await applyDueBankChanges(due)).toEqual({ applied: 0 });
    const coop = await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperativeId } });
    expect(coop.recipientCode).toBe(newCode);
    expect(coop.accountName).toBe("OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD");
    expect(coop.bankName).toBe("Access Bank");
    const row = await prisma.bankChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.appliedAt?.toISOString()).toBe(due.toISOString());
    expect(await effectiveRecipientCode(owner(), due)).toBe(newCode);
    const audit = await prisma.auditLog.findMany({ where: { action: "bank.change.applied", entityId: request.id } });
    expect(audit).toHaveLength(1);
  });

  it("is safe to run twice concurrently", async () => {
    const { request } = await firstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    const due = new Date(T.getTime() + 48 * HOUR);
    const results = await Promise.all([applyDueBankChanges(due), applyDueBankChanges(due)]);
    expect(results.map((r) => r.applied).sort()).toEqual([0, 1]);
  });

  it("is registered as the bank-change-apply job", () => {
    expect(getJob("bank-change-apply")).toBeTypeOf("function");
  });

});

describe("getCooperativeBankAccount", () => {
  it("shows bank and account name, the pending state, and never the recipient code", async () => {
    const { request } = await firstThenSecond();
    const pending = await getCooperativeBankAccount(officer, cooperativeId, T);
    expect(pending).toEqual({
      bankName: "Guaranty Trust Bank",
      accountName: "OGUN FARMERS COOP SOC",
      change: { state: "AWAITING_CONFIRMATION", effectiveAt: null },
    });
    expect(JSON.stringify(pending)).not.toContain("RCP_");
    await confirmBankChange(request.confirmToken, T);
    const confirmed = await getCooperativeBankAccount(officer, cooperativeId, T);
    expect(confirmed.change).toEqual({
      state: "CONFIRMED",
      effectiveAt: new Date(T.getTime() + 48 * HOUR).toISOString(),
    });
    // Once effective, the new account shows even before the job has run.
    const later = await getCooperativeBankAccount(officer, cooperativeId, new Date(T.getTime() + 48 * HOUR));
    expect(later).toEqual({
      bankName: "Access Bank",
      accountName: "OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD",
      change: null,
    });
  });

  it("forbids a farmer and an officer of another cooperative", async () => {
    await expect(
      getCooperativeBankAccount({ ...officer, role: "FARMER" }, cooperativeId, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getCooperativeBankAccount({ ...officer, cooperativeId: "other" }, "other-coop", T),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("farmer bank account", () => {
  const FARMER_NAME = "Ada Okafor";
  const FARMER_OLD = "1111111111";
  const FARMER_NEW = "2222222222";
  let farmerUserId: string;
  let profileId: string;
  const farmerOwner = () => ({ type: "FARMER" as const, id: profileId });

  beforeEach(async () => {
    fakePaystack.accounts.set(`058:${FARMER_OLD}`, "OKAFOR ADA");
    fakePaystack.accounts.set(`044:${FARMER_NEW}`, "ADA CHIOMA OKAFOR");
    const user = await createTestUser({ id: "u-farmer", name: FARMER_NAME, email: "ada@example.com" });
    farmerUserId = user.id;
    await prisma.membership.create({
      data: { userId: user.id, role: "FARMER", cooperativeId, status: "PENDING" },
    });
    const profile = await prisma.farmerProfile.create({
      data: {
        userId: user.id,
        cooperativeId,
        farmSizeHectares: "2.5",
        state: "Ogun",
        lga: "Abeokuta North",
      },
    });
    profileId = profile.id;
  });

  async function farmerFirstThenSecond() {
    await setOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: FARMER_OLD, bankCode: "058" }, T);
    const oldCode = fakePaystack.recipients[fakePaystack.recipients.length - 1];
    fakeOutbox.clear();
    const second = await setOwnFarmerBankAccount(
      { userId: farmerUserId },
      { accountNumber: FARMER_NEW, bankCode: "044" },
      T,
    );
    const request = await prisma.bankChangeRequest.findFirstOrThrow({
      where: { ownerType: "FARMER", ownerId: profileId, cancelledAt: null },
      orderBy: { createdAt: "desc" },
    });
    const newCode = fakePaystack.recipients[fakePaystack.recipients.length - 1];
    return { oldCode, newCode, second, request };
  }

  it("previews the bank's name for the farmer's own account, storing nothing", async () => {
    fakePaystack.accounts.set("057:1111111111", "MUSA BELLO");
    await expect(
      previewOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: FARMER_OLD, bankCode: "058" }),
    ).resolves.toEqual({ accountName: "OKAFOR ADA", matches: true, registeredName: FARMER_NAME });
    await expect(
      previewOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: "1111111111", bankCode: "057" }),
    ).resolves.toEqual({ accountName: "MUSA BELLO", matches: false, registeredName: FARMER_NAME });
    await expect(
      previewOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: "2222222222", bankCode: "058" }),
    ).rejects.toMatchObject({ code: "BANK_ACCOUNT_NOT_FOUND" });
    await expect(
      previewOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: "12345", bankCode: "058" }),
    ).rejects.toMatchObject({ code: "INVALID_ACCOUNT_NUMBER" });
    expect(fakePaystack.recipients).toEqual([]);
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { id: profileId } });
    expect(profile.recipientCode).toBeNull();
  });

  it("refuses a preview for someone with no farmer profile", async () => {
    await createTestUser({ id: "u-nobody" });
    await expect(
      previewOwnFarmerBankAccount({ userId: "u-nobody" }, { accountNumber: FARMER_OLD, bankCode: "058" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sets the first account immediately on the profile", async () => {
    const result = await setOwnFarmerBankAccount(
      { userId: farmerUserId },
      { accountNumber: FARMER_OLD, bankCode: "058" },
      T,
    );
    expect(result).toEqual({ accountName: "OKAFOR ADA", pending: false });
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { id: profileId } });
    expect(profile.recipientCode).toBe(fakePaystack.recipients[0]);
    expect(profile.accountName).toBe("OKAFOR ADA");
    expect(await prisma.bankChangeRequest.count()).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { action: "bank.set", entityId: profileId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: farmerUserId, entity: "farmer_profile" });
    expect(await effectiveRecipientCode(farmerOwner(), T)).toBe(fakePaystack.recipients[0]);
  });

  it("works for an ACTIVE farmer too", async () => {
    await prisma.membership.updateMany({ where: { userId: farmerUserId }, data: { status: "ACTIVE" } });
    await expect(
      setOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: FARMER_OLD, bankCode: "058" }, T),
    ).resolves.toMatchObject({ pending: false });
  });

  it("makes a second account pending and emails the farmer a link", async () => {
    const { second, request } = await farmerFirstThenSecond();
    expect(second).toEqual({ accountName: "ADA CHIOMA OKAFOR", pending: true });
    expect(request.requestedBy).toBe(farmerUserId);
    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].to).toBe("ada@example.com");
    expect(fakeOutbox.sent[0].html).toContain(`/bank/confirm?token=${request.confirmToken}`);
    expect(fakeOutbox.sent[0].html).not.toContain(FARMER_NEW);
  });

  it("bank_change_takes_effect_after_48_hours", async () => {
    const { oldCode, newCode, request } = await farmerFirstThenSecond();
    const { effectiveAt } = await confirmBankChange(request.confirmToken, T);
    expect(effectiveAt.toISOString()).toBe(new Date(T.getTime() + 48 * HOUR).toISOString());
    const justBefore = new Date(T.getTime() + 47 * HOUR + 59 * 60_000);
    expect(await effectiveRecipientCode(farmerOwner(), justBefore)).toBe(oldCode);
    expect(await effectiveRecipientCode(farmerOwner(), new Date(T.getTime() + 48 * HOUR))).toBe(newCode);
  });

  it("alerts ACTIVE admins with the farmer's name when a change is confirmed", async () => {
    await addAdmin("u-admin-1");
    const { request } = await farmerFirstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    const toAdmins = fakeOutbox.sent.filter((m) => m.to === "u-admin-1@example.com");
    expect(toAdmins).toHaveLength(1);
    expect(toAdmins[0].html).toContain(FARMER_NAME);
    expect(toAdmins[0].html).toContain("ADA CHIOMA OKAFOR");
    expect(toAdmins[0].html).not.toContain(FARMER_NEW);
  });

  it("copies the due request onto the farmer profile once", async () => {
    const { newCode, request } = await farmerFirstThenSecond();
    await confirmBankChange(request.confirmToken, T);
    expect(await applyDueBankChanges(new Date(T.getTime() + 47 * HOUR))).toEqual({ applied: 0 });
    const due = new Date(T.getTime() + 48 * HOUR);
    expect(await applyDueBankChanges(due)).toEqual({ applied: 1 });
    expect(await applyDueBankChanges(due)).toEqual({ applied: 0 });
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { id: profileId } });
    expect(profile.recipientCode).toBe(newCode);
    expect(profile.accountName).toBe("ADA CHIOMA OKAFOR");
    expect(await effectiveRecipientCode(farmerOwner(), due)).toBe(newCode);
    const audit = await prisma.auditLog.findMany({ where: { action: "bank.change.applied", entityId: request.id } });
    expect(audit).toHaveLength(1);
  });

  it("applies cooperative and farmer changes in the same run", async () => {
    const coop = await firstThenSecond();
    await confirmBankChange(coop.request.confirmToken, T);
    const farmer = await farmerFirstThenSecond();
    await confirmBankChange(farmer.request.confirmToken, T);
    expect(await applyDueBankChanges(new Date(T.getTime() + 48 * HOUR))).toEqual({ applied: 2 });
  });

  it("uses the user's name as the registered name", async () => {
    fakePaystack.accounts.set(`058:${FARMER_OLD}`, "BOLA ADEYEMI");
    await expect(
      setOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: FARMER_OLD, bankCode: "058" }, T),
    ).rejects.toMatchObject({ code: "ACCOUNT_NAME_MISMATCH" });
    expect(fakePaystack.recipients).toHaveLength(0);
  });

  it("forbids a user with no farmer profile", async () => {
    const other = await createTestUser({ id: "u-nobody" });
    await expect(
      setOwnFarmerBankAccount({ userId: other.id }, { accountNumber: FARMER_OLD, bankCode: "058" }, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids a farmer whose membership has ended", async () => {
    for (const status of ["LEFT", "REMOVED"] as const) {
      await prisma.membership.updateMany({ where: { userId: farmerUserId }, data: { status } });
      await expect(
        setOwnFarmerBankAccount({ userId: farmerUserId }, { accountNumber: FARMER_OLD, bankCode: "058" }, T),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(fakePaystack.recipients).toHaveLength(0);
  });

  it("never stores, audits or logs the farmer's account number", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const { request } = await farmerFirstThenSecond();
      await confirmBankChange(request.confirmToken, T);
      await applyDueBankChanges(new Date(T.getTime() + 48 * HOUR));
      const texts = [
        JSON.stringify(await prisma.bankChangeRequest.findMany()),
        JSON.stringify(await prisma.farmerProfile.findMany()),
        JSON.stringify(await prisma.auditLog.findMany()),
        JSON.stringify(spies.flatMap((s) => s.mock.calls)),
      ];
      for (const text of texts) {
        expect(text).not.toContain(FARMER_OLD);
        expect(text).not.toContain(FARMER_NEW);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("shows the farmer their account name and the pending state, never the recipient code", async () => {
    const { request } = await farmerFirstThenSecond();
    const pending = await getOwnFarmerBankAccount({ userId: farmerUserId }, T);
    expect(pending).toEqual({
      bankName: null,
      accountName: "OKAFOR ADA",
      change: { state: "AWAITING_CONFIRMATION", effectiveAt: null },
    });
    expect(JSON.stringify(pending)).not.toContain("RCP_");
    await confirmBankChange(request.confirmToken, T);
    const later = await getOwnFarmerBankAccount(
      { userId: farmerUserId },
      new Date(T.getTime() + 48 * HOUR),
    );
    expect(later).toMatchObject({ accountName: "ADA CHIOMA OKAFOR", change: null });
  });

  it("returns null for a user with no farmer profile", async () => {
    await expect(getOwnFarmerBankAccount({ userId: "u-nobody" }, T)).resolves.toBeNull();
  });
});
