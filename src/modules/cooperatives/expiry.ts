import type { Cooperative } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { runOnce } from "@/lib/jobs/run-once";
import { recordAudit } from "@/modules/audit/audit";
import {
  certificateExpiredEmail,
  certificateExpiryDigestEmail,
  certificateReminderEmail,
  type CertificateDigestEntry,
} from "@/modules/notifications/emails";
import { listActiveAdminEmails } from "@/modules/notifications/recipients";
import { CERTIFICATE_EXPIRED_NOTE } from "./schema";

const DAY_MS = 86_400_000;
const REMINDER_WINDOW_DAYS = 30;


function logEmailFailure(
  kind: string,
  cooperativeId: string | null,
  err: unknown,
): void {
  // Never log the recipient or the html.
  console.error("certificate expiry email failed", {
    kind,
    cooperativeId,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message }
        : "non-Error thrown",
  });
}

// Runs after the database change has committed, so nothing here may throw.
async function emailOfficers(
  cooperative: Pick<Cooperative, "id">,
  kind: string,
  message: { subject: string; html: string },
): Promise<void> {
  try {
    const officers = await prisma.membership.findMany({
      where: { cooperativeId: cooperative.id, role: "OFFICER", status: "ACTIVE" },
      select: { user: { select: { email: true } } },
    });
    const results = await Promise.allSettled(
      officers.map((officer) => sendEmail({ to: officer.user.email, ...message })),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logEmailFailure(kind, cooperative.id, result.reason);
      }
    }
  } catch (err) {
    logEmailFailure(kind, cooperative.id, err);
  }
}

async function sendDigest(
  now: Date,
  reminded: CertificateDigestEntry[],
  lapsed: CertificateDigestEntry[],
): Promise<void> {
  if (reminded.length === 0 && lapsed.length === 0) return;
  const day = now.toISOString().slice(0, 10);
  await runOnce(`cert-digest:${day}`, async () => {
    try {
      const admins = await listActiveAdminEmails();
      const message = certificateExpiryDigestEmail({ reminded, lapsed });
      const results = await Promise.allSettled(
        admins.map((to) => sendEmail({ to, ...message })),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logEmailFailure("digest", null, result.reason);
        }
      }
    } catch (err) {
      logEmailFailure("digest", null, err);
    }
  });
}

// System function, no Actor: called by the daily cron job, and no user triggers it.
// Lapses VERIFIED cooperatives whose certificate has expired (back to PENDING with
// submittedAt cleared, so the next upload re-submits), reminds officers once per
// certificate expiry date 30 days out, and sends admins one digest per UTC day.
export async function runCertificateExpiry(
  now: Date,
): Promise<{ lapsed: number; reminded: number }> {
  const lapsedEntries: CertificateDigestEntry[] = [];
  const remindedEntries: CertificateDigestEntry[] = [];

  const expired = await prisma.cooperative.findMany({
    where: { status: "VERIFIED", certificateExpiresAt: { lte: now } },
  });
  for (const cooperative of expired) {
    // Conditional on the status: of two concurrent runs exactly one gets count 1.
    const { count } = await prisma.cooperative.updateMany({
      where: {
        id: cooperative.id,
        status: "VERIFIED",
        certificateExpiresAt: { lte: now },
      },
      data: {
        status: "PENDING",
        submittedAt: null,
        reviewNote: CERTIFICATE_EXPIRED_NOTE,
      },
    });
    if (count === 0) continue;
    await recordAudit({
      actorId: null,
      action: "cooperative.lapse",
      entity: "cooperative",
      entityId: cooperative.id,
      meta: { from: "VERIFIED", to: "PENDING" },
    });
    await emailOfficers(
      cooperative,
      "expired",
      certificateExpiredEmail({ cooperativeName: cooperative.name }),
    );
    lapsedEntries.push({
      name: cooperative.name,
      expiresAt: cooperative.certificateExpiresAt,
    });
  }

  const expiring = await prisma.cooperative.findMany({
    where: {
      status: "VERIFIED",
      certificateExpiresAt: {
        gt: now,
        lte: new Date(now.getTime() + REMINDER_WINDOW_DAYS * DAY_MS),
      },
    },
  });
  for (const cooperative of expiring) {
    // Keyed by expiry date: a renewed certificate gets a fresh reminder next year.
    const date = cooperative.certificateExpiresAt.toISOString().slice(0, 10);
    const outcome = await runOnce(
      `cert-reminder:${cooperative.id}:${date}`,
      async () => {
        await emailOfficers(
          cooperative,
          "reminder",
          certificateReminderEmail({
            cooperativeName: cooperative.name,
            expiresAt: cooperative.certificateExpiresAt,
          }),
        );
      },
    );
    if (outcome === "ran") {
      remindedEntries.push({
        name: cooperative.name,
        expiresAt: cooperative.certificateExpiresAt,
      });
    }
  }

  await sendDigest(now, remindedEntries, lapsedEntries);
  return { lapsed: lapsedEntries.length, reminded: remindedEntries.length };
}
