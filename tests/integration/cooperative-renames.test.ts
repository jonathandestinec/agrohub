import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import type { Actor } from "@/modules/identity/policies";
import {
  getCooperativeRename,
  requestCooperativeRename,
  requestOwnNameChange,
  withdrawCooperativeRename,
} from "@/modules/name-changes/service";
import type { NameChangeFile } from "@/modules/name-changes/schema";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const HOUR = 3_600_000;
const T = new Date("2031-06-10T12:00:00Z");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const certificate: NameChangeFile = {
  kind: "AMENDED_REGISTRATION_CERTIFICATE",
  body: PNG,
  contentType: "image/png",
};
const input = { newName: "Zaria Grain and Soy Growers", reason: "Members voted to add soy in 2031" };

let cooperativeId: string;
let officer: Actor;
let secondOfficer: Actor;

async function officerOf(id: string, coopId: string): Promise<Actor> {
  await createTestUser({ id, name: `Officer ${id}` });
  await prisma.membership.create({
    data: { userId: id, role: "OFFICER", cooperativeId: coopId, status: "ACTIVE" },
  });
  return { userId: id, role: "OFFICER", cooperativeId: coopId, twoFactorEnabled: true };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  const coop = await createTestCooperative({
    name: "Zaria Grain Growers",
    status: "VERIFIED",
    recipientCode: "RCP_coop",
    accountName: "ZARIA GRAIN GROWERS COOPERATIVE SOCIETY",
    bankName: "Test Bank",
  });
  cooperativeId = coop.id;
  officer = await officerOf("u-officer-1", cooperativeId);
  secondOfficer = await officerOf("u-officer-2", cooperativeId);
});

describe("requestCooperativeRename", () => {
  it("requests a rename of a verified cooperative", async () => {
    const view = await requestCooperativeRename(officer, cooperativeId, input, certificate, T);
    expect(view).toMatchObject({
      subjectType: "COOPERATIVE",
      fromName: "Zaria Grain Growers",
      toName: "Zaria Grain and Soy Growers",
      status: "PENDING",
    });
    const row = await prisma.nameChangeRequest.findFirstOrThrow();
    expect(row.subjectId).toBe(cooperativeId);
    expect(row.requestedByUserId).toBe(officer.userId);
    expect(row.storageKey.startsWith(`name-changes/COOPERATIVE/${cooperativeId}/`)).toBe(true);
    expect((await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperativeId } })).name).toBe(
      "Zaria Grain Growers",
    );
  });

  it("refuses officers without two-factor, of another cooperative, and farmers", async () => {
    await expect(
      requestCooperativeRename({ ...officer, twoFactorEnabled: false }, cooperativeId, input, certificate, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestCooperative({ status: "VERIFIED" });
    const outsider = await officerOf("u-outsider", other.id);
    await expect(
      requestCooperativeRename(outsider, cooperativeId, input, certificate, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const farmer: Actor = { userId: "u-farmer", role: "FARMER", cooperativeId, twoFactorEnabled: true };
    await expect(
      requestCooperativeRename(farmer, cooperativeId, input, certificate, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps the direct edit for a cooperative not yet verified", async () => {
    await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status: "PENDING" } });
    expect(await codeOf(requestCooperativeRename(officer, cooperativeId, input, certificate, T))).toBe(
      "COOPERATIVE_NOT_VERIFIED",
    );
    await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status: "SUSPENDED" } });
    const view = await requestCooperativeRename(officer, cooperativeId, input, certificate, T);
    expect(view.status).toBe("PENDING");
  });

  it("accepts only the amended registration certificate", async () => {
    expect(
      await codeOf(
        requestCooperativeRename(
          officer,
          cooperativeId,
          input,
          { kind: "AFFIDAVIT", body: PDF, contentType: "application/pdf" },
          T,
        ),
      ),
    ).toBe("INVALID_DOCUMENT_KIND");
  });

  it("is refused while a cooperative bank change waits its 48 hours", async () => {
    await prisma.bankChangeRequest.create({
      data: {
        ownerType: "COOPERATIVE",
        ownerId: cooperativeId,
        newRecipientCode: "RCP_new",
        newAccountName: "ZARIA GRAIN GROWERS",
        newBankName: "Test Bank",
        requestedBy: officer.userId,
        confirmToken: "tok-coop",
        createdAt: new Date(T.getTime() - HOUR),
        confirmedAt: new Date(T.getTime() - HOUR),
        effectiveAt: new Date(T.getTime() + 47 * HOUR),
      },
    });
    expect(await codeOf(requestCooperativeRename(officer, cooperativeId, input, certificate, T))).toBe(
      "BANK_CHANGE_OPEN",
    );
  });

  it("two_officers_racing_get_one_request", async () => {
    const results = await Promise.allSettled([
      requestCooperativeRename(officer, cooperativeId, input, certificate, T),
      requestCooperativeRename(secondOfficer, cooperativeId, { ...input, newName: "Zaria Soy Growers" }, certificate, T),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("NAME_CHANGE_ALREADY_PENDING");
    expect(await prisma.nameChangeRequest.count()).toBe(1);
  });

  it("is independent of the officer's own name change", async () => {
    await requestCooperativeRename(officer, cooperativeId, input, certificate, T);
    const own = await requestOwnNameChange(
      { userId: officer.userId },
      { newName: "Musa Ibrahim", reason: "Affidavit sworn in Zaria" },
      { kind: "AFFIDAVIT", body: PDF, contentType: "application/pdf" },
      T,
    );
    expect(own.status).toBe("PENDING");
    expect(await prisma.nameChangeRequest.count({ where: { status: "PENDING" } })).toBe(2);
  });
});

describe("reading and withdrawing a cooperative rename", () => {
  it("an admin reads it and another officer withdraws it", async () => {
    const request = await requestCooperativeRename(officer, cooperativeId, input, certificate, T);
    const admin: Actor = { userId: "u-admin", role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
    expect((await getCooperativeRename(admin, cooperativeId))?.id).toBe(request.id);
    const buyer: Actor = { userId: "u-buyer", role: "BUYER", cooperativeId: null, twoFactorEnabled: true };
    await expect(getCooperativeRename(buyer, cooperativeId)).rejects.toBeInstanceOf(ForbiddenError);

    const withdrawn = await withdrawCooperativeRename(secondOfficer, cooperativeId, request.id, T);
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(
      await codeOf(withdrawCooperativeRename(secondOfficer, cooperativeId, request.id, T)),
    ).toBe("NAME_CHANGE_NOT_PENDING");
  });

  it("cannot withdraw another cooperative's request", async () => {
    const request = await requestCooperativeRename(officer, cooperativeId, input, certificate, T);
    const other = await createTestCooperative({ status: "VERIFIED" });
    const outsider = await officerOf("u-outsider", other.id);
    expect(await codeOf(withdrawCooperativeRename(outsider, other.id, request.id, T))).toBe(
      "NAME_CHANGE_NOT_PENDING",
    );
  });
});
