import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakeOutbox, sendEmail } from "@/lib/email";
import { fakeStorage } from "@/lib/storage";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  listVerificationQueue,
  reinstateCooperative,
  uploadDocument,
  rejectCooperative,
  suspendCooperative,
  verifyCooperative,
} from "@/modules/cooperatives/service";
import { getCooperativeBankAccount } from "@/modules/banking/service";
import type { Actor } from "@/modules/identity/policies";
import {
  cleanDatabase,
  createTestCooperative,
  createTestUser,
} from "./helpers";

// Wraps the real sendEmail so a single test can make it reject.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const NOW =new Date("2031-06-10T12:00:00Z");
const KINDS: DocumentKind[] = [
  "REGISTRATION_CERTIFICATE",
  "BYLAWS",
  "OFFICER_LIST",
];

const admin: Actor = {
  userId: "admin-1",
  role: "ADMIN",
  cooperativeId: null,
  twoFactorEnabled: true,
};

async function addDocuments(cooperativeId: string, kinds = KINDS) {
  for (const kind of kinds) {
    await prisma.cooperativeDocument.create({
      data: {
        cooperativeId,
        kind,
        storageKey: `cooperatives/${cooperativeId}/${kind}/k`,
        contentType: "application/pdf",
        sizeBytes: 10,
        uploadedBy: "u-officer",
      },
    });
  }
}

async function addMember(
  cooperativeId: string,
  id: string,
  status: "ACTIVE" | "PENDING" = "ACTIVE",
  role: "OFFICER" | "FARMER" = "OFFICER",
) {
  await createTestUser({ id });
  await prisma.membership.create({
    data: { userId: id, role, cooperativeId, status },
  });
}

async function submittedCooperative(
  overrides: Parameters<typeof createTestCooperative>[0] = {},
) {
  const coop = await createTestCooperative({
    certificateExpiresAt: new Date("2035-01-01T00:00:00Z"),
    submittedAt: new Date("2031-06-01T00:00:00Z"),
    ...overrides,
  });
  await addDocuments(coop.id);
  return coop;
}

function auditRows(entityId: string) {
  return prisma.auditLog.findMany({
    where: { entity: "cooperative", entityId },
    orderBy: { createdAt: "asc" },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("listVerificationQueue", () => {
  it("lists PENDING submitted cooperatives oldest first", async () => {
    const newer = await submittedCooperative({
      submittedAt: new Date("2031-06-05T00:00:00Z"),
    });
    const older = await submittedCooperative({
      submittedAt: new Date("2031-06-02T00:00:00Z"),
    });
    await createTestCooperative({ submittedAt: null });
    await submittedCooperative({ status: "VERIFIED" });
    const queue = await listVerificationQueue(admin, NOW);
    expect(queue.map((c) => c.id)).toEqual([older.id, newer.id]);
  });

  it("computes waitingDays as whole days", async () => {
    await submittedCooperative({
      submittedAt: new Date(NOW.getTime() - (3 * 24 + 2) * 3_600_000),
    });
    const [item] = await listVerificationQueue(admin, NOW);
    expect(item.waitingDays).toBe(3);
  });

  it("shows only the latest document per kind", async () => {
    const coop = await submittedCooperative();
    await addDocuments(coop.id, ["BYLAWS"]);
    const [item] = await listVerificationQueue(admin, NOW);
    expect(item.documents).toHaveLength(3);
  });

  it("refuses non-admins", async () => {
    const officer: Actor = { ...admin, role: "OFFICER", cooperativeId: "c" };
    await expect(listVerificationQueue(officer, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("verifyCooperative", () => {
  it("verifies and emails each active officer exactly once", async () => {
    const coop = await submittedCooperative();
    await addMember(coop.id, "o1");
    await addMember(coop.id, "o2");
    await addMember(coop.id, "o3", "PENDING");
    await addMember(coop.id, "f1", "ACTIVE", "FARMER");
    const result = await verifyCooperative(admin, coop.id, NOW);
    expect(result.status).toBe("VERIFIED");
    expect(result.verifiedAt?.toISOString()).toBe(NOW.toISOString());
    expect(fakeOutbox.sent.map((m) => m.to).sort()).toEqual([
      "o1@example.com",
      "o2@example.com",
    ]);
  });

  it("writes one audit row with from and to", async () => {
    const coop = await submittedCooperative();
    await verifyCooperative(admin, coop.id, NOW);
    const rows = await auditRows(coop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("cooperative.verify");
    expect(rows[0].actorId).toBe(admin.userId);
    expect(rows[0].meta).toEqual({ from: "PENDING", to: "VERIFIED" });
  });

  it("rejects an expired certificate and leaves the status alone", async () => {
    const coop = await submittedCooperative({
      certificateExpiresAt: new Date("2031-06-10T12:00:00Z"),
    });
    await expect(verifyCooperative(admin, coop.id, NOW)).rejects.toMatchObject({
      name: "ValidationError",
      code: "CERTIFICATE_EXPIRED",
    });
    const after = await prisma.cooperative.findUnique({ where: { id: coop.id } });
    expect(after?.status).toBe("PENDING");
  });

  it("requires submission and all three documents", async () => {
    const unsubmitted = await createTestCooperative({ submittedAt: null });
    await addDocuments(unsubmitted.id);
    await expect(
      verifyCooperative(admin, unsubmitted.id, NOW),
    ).rejects.toMatchObject({ code: "NOT_SUBMITTED" });
    const partial = await createTestCooperative({
      submittedAt: new Date("2031-06-01T00:00:00Z"),
    });
    await addDocuments(partial.id, ["BYLAWS", "OFFICER_LIST"]);
    await expect(verifyCooperative(admin, partial.id, NOW)).rejects.toMatchObject({
      code: "DOCUMENTS_MISSING",
    });
  });

  it("refuses an officer", async () => {
    const coop = await submittedCooperative();
    const officer: Actor = {
      userId: "o1",
      role: "OFFICER",
      cooperativeId: coop.id,
      twoFactorEnabled: false,
    };
    await expect(verifyCooperative(officer, coop.id, NOW)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses to verify an already verified cooperative", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    await expect(verifyCooperative(admin, coop.id, NOW)).rejects.toMatchObject({
      name: "ConflictError",
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("lets only one of two concurrent verifications win, with one email per officer", async () => {
    const coop = await submittedCooperative();
    await addMember(coop.id, "o1");
    await addMember(coop.id, "o2");
    const results = await Promise.allSettled([
      verifyCooperative(admin, coop.id, NOW),
      verifyCooperative(admin, coop.id, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(fakeOutbox.sent).toHaveLength(2);
    expect(await auditRows(coop.id)).toHaveLength(1);
  });
});

describe("rejectCooperative", () => {
  it("keeps it PENDING, stores the note, clears submittedAt, audits and emails", async () => {
    const coop = await submittedCooperative();
    await addMember(coop.id, "o1");
    const result = await rejectCooperative(admin, coop.id, "  Bylaws unreadable ", NOW);
    expect(result.status).toBe("PENDING");
    expect(result.reviewNote).toBe("Bylaws unreadable");
    expect(result.submittedAt).toBeNull();
    const rows = await auditRows(coop.id);
    expect(rows.map((r) => r.action)).toEqual(["cooperative.reject"]);
    expect(rows[0].meta).toEqual({
      from: "PENDING",
      to: "PENDING",
      reason: "Bylaws unreadable",
    });
    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].html).toContain("Bylaws unreadable");
  });

  it("rejects an empty or too long reason", async () => {
    const coop = await submittedCooperative();
    await expect(rejectCooperative(admin, coop.id, "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      rejectCooperative(admin, coop.id, "x".repeat(501)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      rejectCooperative(admin, coop.id, "x".repeat(500)),
    ).resolves.toBeDefined();
  });

  it("cannot reject a cooperative that is not awaiting review", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    await expect(rejectCooperative(admin, coop.id, "no")).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
  });
});

describe("suspend and reinstate", () => {
  it("suspends a VERIFIED cooperative then reinstates it, auditing and emailing", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    await addMember(coop.id, "o1");
    const suspended = await suspendCooperative(admin, coop.id, "Complaint under review", NOW);
    expect(suspended.status).toBe("SUSPENDED");
    const reinstated = await reinstateCooperative(admin, coop.id, NOW);
    expect(reinstated.status).toBe("VERIFIED");
    const rows = await auditRows(coop.id);
    expect(rows.map((r) => r.action)).toEqual([
      "cooperative.suspend",
      "cooperative.reinstate",
    ]);
    expect(rows[0].meta).toEqual({
      from: "VERIFIED",
      to: "SUSPENDED",
      reason: "Complaint under review",
    });
    expect(rows[1].meta).toEqual({ from: "SUSPENDED", to: "VERIFIED" });
    expect(fakeOutbox.sent).toHaveLength(2);
  });

  it("refuses to suspend a PENDING cooperative", async () => {
    const coop = await submittedCooperative();
    await expect(suspendCooperative(admin, coop.id, "why")).rejects.toMatchObject({
      name: "ConflictError",
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("requires a reason to suspend", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    await expect(suspendCooperative(admin, coop.id, "")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuses to reinstate when the certificate has expired, leaving it SUSPENDED", async () => {
    const coop = await submittedCooperative({
      status: "SUSPENDED",
      certificateExpiresAt: new Date("2031-06-01T00:00:00Z"),
    });
    await addMember(coop.id, "o1");
    const error = await reinstateCooperative(admin, coop.id, NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: "CERTIFICATE_EXPIRED" });
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.status).toBe("SUSPENDED");
    expect(await auditRows(coop.id)).toHaveLength(0);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("refuses to reinstate a VERIFIED cooperative", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    await expect(reinstateCooperative(admin, coop.id)).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("refuses non-admins for suspend and reinstate", async () => {
    const coop = await submittedCooperative({ status: "VERIFIED" });
    const officer: Actor = { ...admin, role: "OFFICER", cooperativeId: coop.id };
    await expect(suspendCooperative(officer, coop.id, "x")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(reinstateCooperative(officer, coop.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("email failures", () => {
  it("keeps the transition, logs the failure and never logs the recipient", async () => {
    const coop = await submittedCooperative();
    await addMember(coop.id, "o1");
    vi.mocked(sendEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await verifyCooperative(admin, coop.id, NOW);
      expect(result.status).toBe("VERIFIED");
      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0];
      expect(JSON.stringify(args)).toContain(coop.id);
      expect(JSON.stringify(args)).not.toContain("o1@example.com");
      expect(await auditRows(coop.id)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("re-submission after rejection", () => {
  it("returns to the queue when an officer re-uploads a document", async () => {
    const coop = await submittedCooperative();
    await addMember(coop.id, "o1");
    await rejectCooperative(admin, coop.id, "Bylaws unreadable", NOW);
    expect(await listVerificationQueue(admin, NOW)).toHaveLength(0);

    fakeStorage.clear();
    const officer: Actor = {
      userId: "o1",
      role: "OFFICER",
      cooperativeId: coop.id,
      twoFactorEnabled: false,
    };
    await uploadDocument(officer, coop.id, {
      kind: "BYLAWS",
      body: Buffer.from("%PDF-1.7 new bylaws"),
      contentType: "application/pdf",
    });

    const after = await prisma.cooperative.findUnique({ where: { id: coop.id } });
    expect(after?.submittedAt).not.toBeNull();
    const queue = await listVerificationQueue(admin, new Date());
    expect(queue.map((c) => c.id)).toEqual([coop.id]);
  });
});

describe("the cooperative's payout account on review", () => {
  it("shows an admin the bank and account name, never the recipient code", async () => {
    const coop = await submittedCooperative({
      recipientCode: "RCP_secret_code",
      accountName: "OGUN FARMERS COOP",
      bankName: "Test Bank",
    });
    const account = await getCooperativeBankAccount(admin, coop.id, NOW);
    expect(account).toEqual({ bankName: "Test Bank", accountName: "OGUN FARMERS COOP", change: null });
    expect(JSON.stringify(account)).not.toContain("RCP_secret_code");
  });
});
