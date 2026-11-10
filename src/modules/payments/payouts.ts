import type { PayoutRecipient, Prisma } from "@/generated/prisma/client";
import { koboToDb, splitTransferParts } from "@/lib/money";
import { effectiveRecipientCode } from "@/modules/banking/service";

// Nigerian card and transfer settlements land the next day: a payout is sent no sooner than
// this long after its order's payment was confirmed.
export const PAYOUT_CLEARING_HOURS = 24;

export type PayoutShare = { recipientType: PayoutRecipient; recipientId: string; amountKobo: number };

export type CreatedPayout = { id: string; status: "QUEUED" | "BLOCKED"; amountKobo: number; recipientType: PayoutRecipient };

/**
 * The payout reference, unique in the database and sent to Paystack as the start of each
 * transfer reference. Paystack accepts only lowercase letters, digits, "-" and "_".
 */
export function payoutReference(orderId: string, recipientType: PayoutRecipient, recipientId: string, part: number): string {
  return `po_${orderId}_${recipientType === "COOPERATIVE" ? "c" : "f"}_${recipientId}_${part}`.toLowerCase();
}

// The account a share is paid to, fixed at release: the owner's effective account at `now`
// (a bank change still inside its 48-hour wait does not count yet). A farmer with no profile,
// no account, or no longer an active member of the cooperative gets none: the payout is
// BLOCKED for an admin, never skipped and never redirected to the cooperative.
async function accountFor(
  tx: Prisma.TransactionClient,
  cooperativeId: string,
  share: PayoutShare,
  now: Date,
): Promise<{ bankOwnerId: string | null; recipientCode: string | null }> {
  if (share.recipientType === "COOPERATIVE") {
    return { bankOwnerId: share.recipientId, recipientCode: await effectiveRecipientCode({ type: "COOPERATIVE", id: share.recipientId }, now) };
  }
  const profile = await tx.farmerProfile.findUnique({ where: { userId: share.recipientId }, select: { id: true } });
  if (!profile) return { bankOwnerId: null, recipientCode: null };
  const member = await tx.membership.count({
    where: { userId: share.recipientId, role: "FARMER", cooperativeId, status: "ACTIVE" },
  });
  const code = await effectiveRecipientCode({ type: "FARMER", id: profile.id }, now);
  return { bankOwnerId: profile.id, recipientCode: member > 0 ? code : null };
}

/**
 * Inside completeOrder's transaction: one payout row per recipient and transfer part (at most
 * ₦10,000,000 each). A zero share creates nothing. Only server code calls this, on the
 * transition to COMPLETED; no recipient or amount ever comes from a client.
 */
export async function createPayouts(
  tx: Prisma.TransactionClient,
  order: { id: string; cooperativeId: string; paidAt: Date | null },
  shares: PayoutShare[],
  now: Date,
): Promise<CreatedPayout[]> {
  const cleared = (order.paidAt ?? now).getTime() + PAYOUT_CLEARING_HOURS * 3_600_000;
  const sendableAt = new Date(Math.max(now.getTime(), cleared));
  const created: CreatedPayout[] = [];
  for (const share of shares) {
    if (share.amountKobo === 0) continue;
    const { bankOwnerId, recipientCode } = await accountFor(tx, order.cooperativeId, share, now);
    const parts = splitTransferParts(share.amountKobo);
    for (const [index, amountKobo] of parts.entries()) {
      const part = index + 1;
      const status = recipientCode ? ("QUEUED" as const) : ("BLOCKED" as const);
      const row = await tx.payout.create({
        data: {
          orderId: order.id,
          recipientType: share.recipientType,
          recipientId: share.recipientId,
          bankOwnerId,
          part,
          amountKobo: koboToDb(amountKobo),
          recipientCode,
          reference: payoutReference(order.id, share.recipientType, share.recipientId, part),
          status,
          sendableAt,
          createdAt: now,
        },
      });
      created.push({ id: row.id, status, amountKobo, recipientType: share.recipientType });
    }
  }
  return created;
}

