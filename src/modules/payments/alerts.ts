import type { PayoutRecipient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { payoutAlertEmail, type PayoutAlertKind } from "@/modules/notifications/emails";
import { listActiveAdminEmails } from "@/modules/notifications/recipients";
import {
  activeAdmins,
  buyer,
  farmer,
  notify,
  officersOf,
  type Db,
} from "@/modules/notifications/service";

export type AdminAlert = {
  kind: PayoutAlertKind;
  orderId: string;
  amountKobo: number;
  recipientType: string;
  detail?: string;
};

/**
 * Emails every active admin about a payment or payout problem (spec 13: alerts on payment
 * failures from day one), and saves an in-app alert for each. Never throws: a mail outage or a
 * failed alert write must not undo or repeat a money step. Logs only the kind and the order id.
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
  // Outside the money step's transaction (this runs after it), so a failure here is logged only.
  try {
    await notify(prisma, {
      kind: alert.kind === "RECONCILIATION" || alert.kind === "STALE" ? "RECONCILIATION_ISSUE" : "PAYOUT_PROBLEM",
      // For a reconciliation issue with no order this holds the payment reference instead.
      subject: { type: "ORDER", id: alert.orderId },
      data: { problem: alert.kind },
      to: await activeAdmins(prisma),
    });
  } catch {
    console.error("admin in-app alert failed", { kind: alert.kind, orderId: alert.orderId });
  }
}

type PayoutFacts = { orderId: string; recipientType: PayoutRecipient; recipientId: string; amountKobo: bigint };

// A payout reached the recipient. A farmer's payout has the farmer's user id as recipient; a
// cooperative's has the cooperative id, so its officers are told. The amount is a decimal string
// because a Json column cannot hold a BigInt.
export async function notifyPayoutSent(db: Db, payout: PayoutFacts): Promise<void> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: payout.orderId },
    select: { cooperativeId: true, lot: { select: { crop: { select: { name: true } } } } },
  });
  await notify(db, {
    kind: "PAYOUT_SENT",
    subject: { type: "ORDER", id: payout.orderId },
    data: { crop: order.lot.crop.name, amountKobo: payout.amountKobo.toString() },
    to:
      payout.recipientType === "COOPERATIVE"
        ? await officersOf(db, payout.recipientId)
        : [farmer(payout.recipientId, order.cooperativeId)],
  });
}

// A buyer's refund reached Paystack's side as processed.
export async function notifyRefundSent(db: Db, refund: { orderId: string; amountKobo: bigint }): Promise<void> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: refund.orderId },
    select: { buyerUserId: true, lot: { select: { crop: { select: { name: true } } } } },
  });
  await notify(db, {
    kind: "REFUND_SENT",
    subject: { type: "ORDER", id: refund.orderId },
    data: { crop: order.lot.crop.name, amountKobo: refund.amountKobo.toString() },
    to: [buyer(order.buyerUserId)],
  });
}
