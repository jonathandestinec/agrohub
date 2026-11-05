import { sendEmail } from "@/lib/email";
import { payoutAlertEmail, type PayoutAlertKind } from "@/modules/notifications/emails";
import { listActiveAdminEmails } from "@/modules/notifications/recipients";

export type AdminAlert = {
  kind: PayoutAlertKind;
  orderId: string;
  amountKobo: number;
  recipientType: string;
  detail?: string;
};

/**
 * Emails every active admin about a payment or payout problem (spec 13: alerts on payment
 * failures from day one). Never throws: a mail outage must not undo or repeat a money step.
 * Logs only the kind and the order id.
 */
export async function alertAdmins(alert: AdminAlert): Promise<void> {
  try {
    const admins = await listActiveAdminEmails();
    const { subject, html } = payoutAlertEmail({
      kind: alert.kind,
      orderReference: alert.orderId.slice(-8).toUpperCase(),
      amountKobo: alert.amountKobo,
      recipientType: alert.recipientType,
      detail: alert.detail,
    });
    const results = await Promise.allSettled(admins.map((to) => sendEmail({ to, subject, html })));
    if (results.some((r) => r.status === "rejected")) {
      console.error("admin alert email failed", { kind: alert.kind, orderId: alert.orderId });
    }
  } catch {
    console.error("admin alert email failed", { kind: alert.kind, orderId: alert.orderId });
  }
}
