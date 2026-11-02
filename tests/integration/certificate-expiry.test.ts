import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox, sendEmail } from "@/lib/email";
import { runCertificateExpiry } from "@/modules/cooperatives/expiry";
import {
  certificateExpiredEmail,
  certificateExpiryDigestEmail,
  certificateReminderEmail,
} from "@/modules/notifications/emails";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

// Wraps the real sendEmail so a single test can make it reject.
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const NOW = new Date("2031-06-10T12:00:00Z");
const DAY = 86_400_000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

async function addMember(
  cooperativeId: string | null,
  role: "OFFICER" | "ADMIN",
  email: string,
) {
  const user = await createTestUser({ email });
  await prisma.membership.create({
    data: { userId: user.id, role, cooperativeId, status: "ACTIVE" },
  });
}

async function verifiedCoop(expires: Date, name = "Test Cooperative") {
  const coop = await createTestCooperative({
    name,
    status: "VERIFIED",
    verifiedAt: new Date("2030-01-01T00:00:00Z"),
    submittedAt: new Date("2029-12-01T00:00:00Z"),
    certificateExpiresAt: expires,
  });
  await addMember(coop.id, "OFFICER", `officer-${coop.id}@example.com`);
  return coop;
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
  vi.mocked(sendEmail).mockClear();
  await clearRuns();
  await cleanDatabase();
});

afterAll(async () => {
  await clearRuns();
  await cleanDatabase();
  await prisma.$disconnect();
});

const officerMail = (id: string) =>
  fakeOutbox.sent.filter((m) => m.to === `officer-${id}@example.com`);

describe("runCertificateExpiry", () => {
  it("lapses a cooperative whose certificate expired yesterday", async () => {
    const coop = await verifiedCoop(days(-1));
    const result = await runCertificateExpiry(NOW);
    expect(result).toEqual({ lapsed: 1, reminded: 0 });
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.status).toBe("PENDING");
    expect(row.submittedAt).toBeNull();
    expect(row.reviewNote).toBe("CERTIFICATE_EXPIRED");
    const audit = await prisma.auditLog.findMany({
      where: { action: "cooperative.lapse", entityId: coop.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({ from: "VERIFIED", to: "PENDING" });
    expect(officerMail(coop.id)).toHaveLength(1);
  });

  it("sends one reminder across two runs on the same day and the next day", async () => {
    const coop = await verifiedCoop(days(10));
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 1 });
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 0 });
    expect(await runCertificateExpiry(days(1))).toEqual({ lapsed: 0, reminded: 0 });
    expect(officerMail(coop.id)).toHaveLength(1);
  });

  it("sends nothing for a certificate expiring in 40 days", async () => {
    const coop = await verifiedCoop(days(40));
    await addMember(null, "ADMIN", "admin@example.com");
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 0 });
    expect(officerMail(coop.id)).toHaveLength(0);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("frees submittedAt on lapse so a re-upload re-submits", async () => {
    const coop = await verifiedCoop(days(-1));
    await runCertificateExpiry(NOW);
    const lapsed = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(lapsed.submittedAt).toBeNull();
    // uploadDocument's guard: it sets submittedAt only while still null.
    const resubmitted = await prisma.cooperative.updateMany({
      where: { id: coop.id, submittedAt: null },
      data: { submittedAt: NOW },
    });
    expect(resubmitted.count).toBe(1);
  });

  it("does not touch a PENDING cooperative with an expired certificate", async () => {
    const coop = await createTestCooperative({
      status: "PENDING",
      submittedAt: new Date("2031-06-01T00:00:00Z"),
      reviewNote: "Fix the bylaws",
      certificateExpiresAt: days(-5),
    });
    await addMember(coop.id, "OFFICER", `officer-${coop.id}@example.com`);
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 0 });
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.reviewNote).toBe("Fix the bylaws");
    expect(row.submittedAt).not.toBeNull();
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("lapses once and reminds once when run twice at the same now", async () => {
    const lapsing = await verifiedCoop(days(-1), "Lapsing");
    const expiring = await verifiedCoop(days(5), "Expiring");
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 1, reminded: 1 });
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 0, reminded: 0 });
    expect(officerMail(lapsing.id)).toHaveLength(1);
    expect(officerMail(expiring.id)).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({
      where: { action: "cooperative.lapse", entityId: lapsing.id },
    });
    expect(audit).toHaveLength(1);
  });

  it("sends the admin digest once per UTC day across two runs", async () => {
    await addMember(null, "ADMIN", "admin@example.com");
    await verifiedCoop(days(-1), "Lapsing Co");
    await verifiedCoop(days(5), "Expiring Co");
    await runCertificateExpiry(NOW);
    const digests = () => fakeOutbox.sent.filter((m) => m.to === "admin@example.com");
    expect(digests()).toHaveLength(1);
    expect(digests()[0].html).toContain("Lapsing Co");
    expect(digests()[0].html).toContain("Expiring Co");
    // Another cooperative comes into the window later the same UTC day.
    await verifiedCoop(days(7), "Late Co");
    await runCertificateExpiry(new Date(NOW.getTime() + 3_600_000));
    expect(digests()).toHaveLength(1);
  });

  it("sends no digest when nothing was reminded or lapsed", async () => {
    await addMember(null, "ADMIN", "admin@example.com");
    await verifiedCoop(days(100));
    await runCertificateExpiry(NOW);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("logs email failures without the address and still completes", async () => {
    const coop = await verifiedCoop(days(-1));
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runCertificateExpiry(NOW)).toEqual({ lapsed: 1, reminded: 0 });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("@example.com");
    spy.mockRestore();
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: coop.id } });
    expect(row.status).toBe("PENDING");
  });
});

describe("certificate expiry emails", () => {
  it("escape names and never say escrow", () => {
    const evil = `<script>alert("x")</script> & Co`;
    const mails = [
      certificateExpiredEmail({ cooperativeName: evil }),
      certificateReminderEmail({ cooperativeName: evil, expiresAt: days(5) }),
      certificateExpiryDigestEmail({
        reminded: [{ name: evil, expiresAt: days(5) }],
        lapsed: [{ name: evil, expiresAt: days(-1) }],
      }),
    ];
    for (const { subject, html } of mails) {
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(`${subject} ${html}`.toLowerCase()).not.toContain("escrow");
    }
  });
});
