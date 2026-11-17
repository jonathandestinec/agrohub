import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { fakeStorage } from "@/lib/storage";
import {
  approveNameChange,
  rejectNameChange,
  requestCooperativeRename,
  requestOwnNameChange,
} from "@/modules/name-changes/service";
import { cleanDatabase } from "./helpers";
import { lotWorld, NOW, type LotWorld } from "./lot-fixtures";

const PDF = { body: Buffer.from("%PDF-1.7 test body"), contentType: "application/pdf" };
const PNG = {
  body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  contentType: "image/png",
};

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakeOutbox.clear();
  w = await lotWorld();
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
});

afterAll(cleanDatabase);

const affidavit = { kind: "AFFIDAVIT" as const, ...PDF };
const personInput = { newName: "Amina Musa", reason: "Married in October 2026" };
const coopInput = { newName: "Zaria Maize Growers", reason: "We changed our registered name" };
const certificate = { kind: "AMENDED_REGISTRATION_CERTIFICATE" as const, ...PNG };
const requestOf = () => prisma.nameChangeRequest.findFirstOrThrow();
const mailTo = (userId: string) => fakeOutbox.sent.filter((m) => m.to === `${userId}@example.com`);

describe("name change emails", () => {
  it("approving a personal name change emails the person and no one else", async () => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    const request = await requestOf();
    fakeOutbox.clear();
    await approveNameChange(w.admin, request.id, NOW);
    expect(mailTo(w.farmer.userId).map((m) => m.subject)).toEqual(["Your name change was approved"]);
    expect(mailTo(w.admin.userId)).toHaveLength(0);
    expect(fakeOutbox.sent).toHaveLength(1);
  });

  it("rejecting one emails the person without the admin's reason", async () => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    const request = await requestOf();
    fakeOutbox.clear();
    await rejectNameChange(w.admin, request.id, { reason: "The document is unclear" }, NOW);
    expect(mailTo(w.farmer.userId).map((m) => m.subject)).toEqual(["Your name change was not approved"]);
    expect(mailTo(w.farmer.userId)[0].html).not.toContain("unclear");
  });

  it("a cooperative rename emails its officers", async () => {
    await requestCooperativeRename(w.officer, w.cooperativeId, coopInput, certificate, NOW);
    const request = await requestOf();
    fakeOutbox.clear();
    await approveNameChange(w.admin, request.id, NOW);
    expect(mailTo(w.officer.userId).map((m) => m.subject)).toEqual(["Your name change was approved"]);
    expect(mailTo(w.officer.userId)[0].html).toContain("/account");
  });

  it("a second decision on the same request fails and sends nothing", async () => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    const request = await requestOf();
    await approveNameChange(w.admin, request.id, NOW);
    fakeOutbox.clear();
    await expect(approveNameChange(w.admin, request.id, NOW)).rejects.toBeDefined();
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("a mail failure leaves the decision saved", async () => {
    await requestOwnNameChange({ userId: w.farmer.userId }, personInput, affidavit, NOW);
    const request = await requestOf();
    const email = await import("@/lib/email");
    const spy = vi.spyOn(email, "sendEmail").mockRejectedValue(new Error("Resend failed to send email (rate_limit_exceeded)"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await approveNameChange(w.admin, request.id, NOW);
    expect((await requestOf()).status).toBe("APPROVED");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/@example\.com|<p>/);
    spy.mockRestore();
    log.mockRestore();
  });
});
