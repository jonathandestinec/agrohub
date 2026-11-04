import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import {
  getOwnNameChange,
  requestOwnNameChange,
  withdrawOwnNameChange,
} from "@/modules/name-changes/service";
import type { NameChangeFile } from "@/modules/name-changes/schema";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const HOUR = 3_600_000;
const T = new Date("2031-06-10T12:00:00Z");
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const affidavit: NameChangeFile = { kind: "AFFIDAVIT", body: PDF, contentType: "application/pdf" };
const input = { newName: "Amina Musa", reason: "Married in October 2026" };

let userId: string;
let profileId: string;
let since: Date;

afterAll(async () => {
  await cleanDatabase();
});

beforeEach(async () => {
  await cleanDatabase();
  since = new Date();
  fakeStorage.clear();
  const coop = await createTestCooperative({ status: "VERIFIED" });
  const user = await createTestUser({ id: "u-amina", name: "Amina Bello" });
  userId = user.id;
  await prisma.membership.create({
    data: { userId, role: "FARMER", cooperativeId: coop.id, status: "ACTIVE" },
  });
  const profile = await prisma.farmerProfile.create({
    data: {
      userId,
      cooperativeId: coop.id,
      farmSizeHectares: "2.5",
      state: "Kaduna",
      lga: "Zaria",
      recipientCode: "RCP_old",
      accountName: "AMINA BELLO",
    },
  });
  profileId = profile.id;
});

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function bankChange(data: { createdAt: Date; confirmedAt?: Date; effectiveAt?: Date }) {
  await prisma.bankChangeRequest.create({
    data: {
      ownerType: "FARMER",
      ownerId: profileId,
      newRecipientCode: "RCP_new",
      newAccountName: "AMINA BELLO",
      newBankName: "Test Bank",
      requestedBy: userId,
      confirmToken: `tok-${Math.random()}`,
      ...data,
    },
  });
}

describe("requestOwnNameChange", () => {
  it("requests_a_name_change", async () => {
    const view = await requestOwnNameChange({ userId }, input, affidavit, T);
    expect(view).toMatchObject({
      subjectType: "USER",
      fromName: "Amina Bello",
      toName: "Amina Musa",
      documentKind: "AFFIDAVIT",
      status: "PENDING",
    });
    expect(fakeStorage.objects.size).toBe(1);
    const audit = await prisma.auditLog.findMany({ where: { action: "name_change.request", createdAt: { gte: since } } });
    expect(audit).toHaveLength(1);
    const meta = JSON.stringify(audit[0].meta);
    expect(meta).not.toContain("Amina");
    expect(meta).not.toContain("Married");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe(
      "Amina Bello",
    );
  });

  it("name_rules", async () => {
    const stored = await requestOwnNameChange(
      { userId },
      { ...input, newName: "  Amina   Musa " },
      affidavit,
      T,
    );
    expect(stored.toName).toBe("Amina Musa");
    await withdrawOwnNameChange({ userId }, stored.id, T);

    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, newName: "Amina  Bello" }, affidavit, T))).toBe("NAME_UNCHANGED");
    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, newName: "  " }, affidavit, T))).toBe("INVALID_NAME");
    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, newName: "12345" }, affidavit, T))).toBe("INVALID_NAME");
    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, newName: "A".repeat(121) }, affidavit, T))).toBe("INVALID_NAME");
    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, reason: "short" }, affidavit, T))).toBe("REASON_REQUIRED");
    expect(await codeOf(requestOwnNameChange({ userId }, { ...input, reason: "x".repeat(501) }, affidavit, T))).toBe("REASON_TOO_LONG");

    const caps = await requestOwnNameChange({ userId }, { ...input, newName: "AMINA BELLO" }, affidavit, T);
    expect(caps.toName).toBe("AMINA BELLO");
  });

  it("checks the document", async () => {
    expect(
      await codeOf(
        requestOwnNameChange({ userId }, input, { ...affidavit, kind: "AMENDED_REGISTRATION_CERTIFICATE" }, T),
      ),
    ).toBe("INVALID_DOCUMENT_KIND");
    expect(
      await codeOf(requestOwnNameChange({ userId }, input, { ...affidavit, contentType: "image/gif" }, T)),
    ).toBe("FILE_TYPE_NOT_ALLOWED");
    expect(await codeOf(requestOwnNameChange({ userId }, input, { ...affidavit, body: PNG }, T))).toBe(
      "FILE_TYPE_MISMATCH",
    );
    const huge = Buffer.alloc(10_485_761);
    PDF.copy(huge);
    expect(await codeOf(requestOwnNameChange({ userId }, input, { ...affidavit, body: huge }, T))).toBe(
      "FILE_TOO_LARGE",
    );
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("second_pending_request_is_refused", async () => {
    const first = await requestOwnNameChange({ userId }, input, affidavit, T);
    expect(
      await codeOf(requestOwnNameChange({ userId }, { ...input, newName: "Amina Sani" }, affidavit, T)),
    ).toBe("NAME_CHANGE_ALREADY_PENDING");
    expect(await prisma.nameChangeRequest.count()).toBe(1);
    expect(fakeStorage.objects.size).toBe(1);
    await withdrawOwnNameChange({ userId }, first.id, T);
    const again = await requestOwnNameChange({ userId }, input, affidavit, T);
    expect(again.status).toBe("PENDING");
  });

  it("refuses two requests racing for one person", async () => {
    const results = await Promise.allSettled([
      requestOwnNameChange({ userId }, input, affidavit, T),
      requestOwnNameChange({ userId }, { ...input, newName: "Amina Sani" }, affidavit, T),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("NAME_CHANGE_ALREADY_PENDING");
    expect(await prisma.nameChangeRequest.count()).toBe(1);
  });

  it("name_change_refused_while_bank_change_open", async () => {
    await bankChange({ createdAt: new Date(T.getTime() - HOUR) });
    expect(await codeOf(requestOwnNameChange({ userId }, input, affidavit, T))).toBe("BANK_CHANGE_OPEN");

    await prisma.bankChangeRequest.deleteMany();
    await bankChange({
      createdAt: new Date(T.getTime() - HOUR),
      confirmedAt: new Date(T.getTime() - HOUR),
      effectiveAt: new Date(T.getTime() + 47 * HOUR),
    });
    expect(await codeOf(requestOwnNameChange({ userId }, input, affidavit, T))).toBe("BANK_CHANGE_OPEN");

    await prisma.bankChangeRequest.deleteMany();
    await bankChange({ createdAt: new Date(T.getTime() - 25 * HOUR) });
    await bankChange({
      createdAt: new Date(T.getTime() - 50 * HOUR),
      confirmedAt: new Date(T.getTime() - 49 * HOUR),
      effectiveAt: new Date(T.getTime() - HOUR),
    });
    const view = await requestOwnNameChange({ userId }, input, affidavit, T);
    expect(view.status).toBe("PENDING");
  });

  it("lets a person with no farmer profile request", async () => {
    const buyer = await createTestUser({ id: "u-buyer", name: "Chidi Okafor" });
    const view = await requestOwnNameChange(
      { userId: buyer.id },
      { newName: "Chidi Eze", reason: "Gazette notice published" },
      { ...affidavit, kind: "PUBLIC_NOTICE" },
      T,
    );
    expect(view.status).toBe("PENDING");
  });
});

describe("withdrawOwnNameChange", () => {
  it("lets only the requester withdraw, once", async () => {
    const request = await requestOwnNameChange({ userId }, input, affidavit, T);
    const other = await createTestUser({ id: "u-other" });
    expect(await codeOf(withdrawOwnNameChange({ userId: other.id }, request.id, T))).toBe(
      "NAME_CHANGE_NOT_PENDING",
    );
    const withdrawn = await withdrawOwnNameChange({ userId }, request.id, T);
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(await codeOf(withdrawOwnNameChange({ userId }, request.id, T))).toBe(
      "NAME_CHANGE_NOT_PENDING",
    );
    expect((await getOwnNameChange({ userId }))?.status).toBe("WITHDRAWN");
    expect(await prisma.auditLog.count({ where: { action: "name_change.withdraw", createdAt: { gte: since } } })).toBe(1);
  });

  it("returns null when there is no request", async () => {
    expect(await getOwnNameChange({ userId })).toBeNull();
  });
});
