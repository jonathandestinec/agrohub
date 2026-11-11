import type { PayoutStatus } from "@/generated/prisma/client";
import type { TileItem } from "@/lib/summary";

// Which problem a payout in the admin's payout list has: failed, blocked, refused for balance,
// or sent and waiting too long for Paystack.
const PAYOUT_PROBLEM: Partial<Record<PayoutStatus, string>> = {
  FAILED: "failed",
  BLOCKED: "blocked",
  QUEUED: "waiting",
  SENT: "stale",
};

// A tile item for a payout problem: the crop of the sold lot and a label for the problem. No
// amount, no recipient name and no account detail.
export function toPayoutIssueTileItem(row: {
  id: string;
  status: PayoutStatus;
  createdAt: Date;
  order: { lot: { crop: { name: string } } };
}): TileItem {
  return {
    id: row.id,
    href: "/admin/payouts",
    title: row.order.lot.crop.name,
    date: row.createdAt.toISOString(),
    label: `home.labels.payout.${PAYOUT_PROBLEM[row.status] ?? "failed"}`,
  };
}

const RECONCILIATION_KINDS = [
  "UNCONFIRMED_PAYMENT",
  "AMOUNT_MISMATCH",
  "STALE_TRANSFER",
  "STALE_REFUND",
  "LEDGER_UNBALANCED",
];

// A tile item for a reconciliation difference: its reference and a label for the kind. The
// issue's detail (ids and amounts) stays on the issue.
export function toReconciliationTileItem(row: { id: string; kind: string; reference: string; createdAt: Date }): TileItem {
  return {
    id: row.id,
    href: "/admin/orders",
    title: row.reference,
    date: row.createdAt.toISOString(),
    ...(RECONCILIATION_KINDS.includes(row.kind) ? { label: `home.labels.reconciliation.${row.kind}` } : {}),
  };
}
