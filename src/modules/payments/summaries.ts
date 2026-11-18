import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { TILE_ITEMS, type Summary } from "@/lib/summary";
import { can, type Actor } from "@/modules/identity/policies";
import { STALE_TRANSFER_HOURS } from "./admin";
import { toPayoutIssueTileItem, toReconciliationTileItem } from "./views";

// Payouts that need an admin, as listPayoutIssues reads them (failed, blocked, refused for
// balance, or awaiting Paystack for over three days), without its row cap, oldest first. The
// title is the crop of the sold lot and the label says which problem; no amount, no recipient.
export async function payoutIssuesSummary(actor: Actor, now: Date = new Date()): Promise<Summary> {
  if (!can(actor, "payout:manage")) throw new ForbiddenError();
  const staleBefore = new Date(now.getTime() - STALE_TRANSFER_HOURS * 3_600_000);
  const where = {
    OR: [
      { status: { in: ["FAILED", "BLOCKED"] as ("FAILED" | "BLOCKED")[] } },
      { status: "QUEUED" as const, balanceRefusals: { gt: 0 } },
      { status: "SENT" as const, attempts: { some: { status: "SENT" as const, createdAt: { lt: staleBefore } } } },
    ],
  };
  const [count, rows] = await Promise.all([
    prisma.payout.count({ where }),
    prisma.payout.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        order: { select: { lot: { select: { crop: { select: { name: true } } } } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toPayoutIssueTileItem) };
}

// Reconciliation differences nobody has resolved, as listReconciliationIssues reads them,
// without its row cap, oldest first.
export async function reconciliationSummary(actor: Actor): Promise<Summary> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const where = { resolvedAt: null };
  const [count, rows] = await Promise.all([
    prisma.reconciliationIssue.count({ where }),
    prisma.reconciliationIssue.findMany({
      where,
      select: { id: true, kind: true, reference: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TILE_ITEMS,
    }),
  ]);
  return { count, items: rows.map(toReconciliationTileItem) };
}
