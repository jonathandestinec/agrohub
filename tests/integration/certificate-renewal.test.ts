import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { fakeStorage } from "@/lib/storage";
import { runCertificateExpiry } from "@/modules/cooperatives/expiry";
import {
  listVerificationQueue,
  uploadDocument,
  verifyCooperative,
} from "@/modules/cooperatives/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const NOW = new Date("2031-06-10T12:00:00Z");
const DAY = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const PDF = Buffer.from("%PDF-1.7 renewed certificate");

const admin: Actor = {
  userId: "admin-1",
  role: "ADMIN",
  cooperativeId: null,
  twoFactorEnabled: true,
};

async function addDocuments(cooperativeId: string, kinds: DocumentKind[]) {
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

async function verifiedCoopWithOfficer(expires: Date) {
  const coop = await createTestCooperative({
    status: "VERIFIED",
    verifiedAt: new Date("2030-06-01T00:00:00Z"),
    submittedAt: new Date("2030-05-01T00:00:00Z"),
    certificateExpiresAt: expires,
  });
  await addDocuments(coop.id, ["REGISTRATION_CERTIFICATE", "BYLAWS", "OFFICER_LIST"]);
  const user = await createTestUser({ id: `off-${coop.id}` });
  await prisma.membership.create({
    data: { userId: user.id, role: "OFFICER", cooperativeId: coop.id, status: "ACTIVE" },
  });
  const officer: Actor = {
    userId: user.id,
    role: "OFFICER",
    cooperativeId: coop.id,
    twoFactorEnabled: false,
  };
  return { coop, officer };
}

function renewCertificate(officer: Actor, cooperativeId: string, expiresAt: Date | undefined) {
  return uploadDocument(
    officer,
    cooperativeId,
    {
      kind: "REGISTRATION_CERTIFICATE",
      body: PDF,
      contentType: "application/pdf",
      certificateExpiresAt: expiresAt,
    },
    NOW,
  );
}

async function clearRuns() {
  await prisma.jobRun.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "cert-reminder:" } },
        { key: { startsWith: "cert-digest:" } },
      ],
    },
  });
}

beforeEach(async () => {
  fakeOutbox.clear();
  fakeStorage.clear();
  await clearRuns();
  await cleanDatabase();
});

afterAll(async () => {
  await clearRuns();
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("certificate renewal", () => {
  it("re-queues a lapsed cooperative when a certificate with a future date is uploaded, and verify succeeds", async () => {
    const { coop, officer } = await verifiedCoopWithOfficer(days(-1));
    expect(await runCertificateExpiry(NOW)).toMatchObject({ lapsed: 1 });

    const renewedUntil = days(365);
    const document = await renewCertificate(officer, coop.id, renewedUntil);

    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.status).toBe("PENDING");
    expect(row.certificateExpiresAt.toISOString()).toBe(renewedUntil.toISOString());
    expect(row.submittedAt).not.toBeNull();
    expect((await listVerificationQueue(admin, NOW)).map((c) => c.id)).toEqual([coop.id]);

    const audit = await prisma.auditLog.findMany({
      where: { action: "cooperative.certificate_renewed", entityId: coop.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(officer.userId);
    expect(audit[0].meta).toMatchObject({ cooperativeId: coop.id, documentId: document.id });

    const verified = await verifyCooperative(admin, coop.id, NOW);
    expect(verified.status).toBe("VERIFIED");
  });

  it("keeps a VERIFIED cooperative that renews inside the window verified, with no reminder for the old date", async () => {
    const { coop, officer } = await verifiedCoopWithOfficer(days(10));
    await renewCertificate(officer, coop.id, days(375));

    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.status).toBe("VERIFIED");

    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 0 });
    // Past the old expiry date: still not lapsed.
    expect(await runCertificateExpiry(days(11))).toEqual({ lapsed: 0, reminded: 0 });
    const after = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(after.status).toBe("VERIFIED");
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("refuses a past, current or missing expiry date and stores nothing", async () => {
    const { coop, officer } = await verifiedCoopWithOfficer(days(10));
    const before = await prisma.cooperativeDocument.count();
    for (const expiresAt of [days(-1), NOW, undefined]) {
      await expect(renewCertificate(officer, coop.id, expiresAt)).rejects.toMatchObject({
        name: "ValidationError",
        code: "CERTIFICATE_EXPIRY_INVALID",
      });
    }
    expect(await prisma.cooperativeDocument.count()).toBe(before);
    expect(fakeStorage.objects.size).toBe(0);
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.certificateExpiresAt.toISOString()).toBe(days(10).toISOString());
  });

  it("does not change the expiry when another document kind is uploaded", async () => {
    const { coop, officer } = await verifiedCoopWithOfficer(days(10));
    await uploadDocument(
      officer,
      coop.id,
      {
        kind: "BYLAWS",
        body: PDF,
        contentType: "application/pdf",
        certificateExpiresAt: days(400),
      },
      NOW,
    );
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.certificateExpiresAt.toISOString()).toBe(days(10).toISOString());
    expect(
      await prisma.auditLog.count({
        where: { action: "cooperative.certificate_renewed", entityId: coop.id },
      }),
    ).toBe(0);
  });
});
