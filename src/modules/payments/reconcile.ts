import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { koboFromDb } from "@/lib/money";
import { listTransactions } from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { STALE_TRANSFER_HOURS } from "./admin";
import { alertAdmins } from "./alerts";
import { confirmPayment } from "./payments";
import { payoutGateway, type PayoutGateway } from "./payout-gateway";
import { issueRefund } from "./refunds";
import { settleAttempt } from "./sending";

const HOUR = 3_600_000;
const LOOKBACK_DAYS = 3;
// A transfer is checked once it has been awaiting Paystack this long (webhooks normally arrive in minutes).
const CHECK_AFTER_HOURS = 1;
const STALE_REFUND_DAYS = 3;

export type IssueKind = "UNCONFIRMED_PAYMENT" | "AMOUNT_MISMATCH" | "STALE_TRANSFER" | "STALE_REFUND" | "LEDGER_UNBALANCED";

type Detail = Prisma.InputJsonObject;

// Records an issue once per kind and reference (ids, amounts and statuses only) and emails the
// admins the first time it is seen. Returns true when it is new.
async function recordIssue(kind: IssueKind, reference: string, orderId: string | null, detail: Detail, amountKobo: number, now: Date): Promise<boolean> {
  try {
    await prisma.reconciliationIssue.create({ data: { kind, reference, orderId, detail, createdAt: now } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
  await alertAdmins({ kind: kind === "STALE_TRANSFER" ? "STALE" : "RECONCILIATION", orderId: orderId ?? reference, amountKobo, recipientType: kind });
  return true;
}

/**
 * System function, no Actor: the daily reconciliation job (07:00 UTC). Compares AgroHub with
 * Paystack and settles what it safely can, recording the rest for admins:
 * 1. every successful Paystack transaction of the last 3 days has a SUCCEEDED payment of the same
 *    amount; a missing one is confirmed first (its webhook never arrived), and recorded only if
 *    that fails;
 * 2. every transfer awaiting Paystack for over an hour is checked and settled as its webhook
 *    would; one still pending after 3 days is flagged;
 * 3. every refund not yet sent to Paystack is sent once; one sent over 3 days ago and still
 *    pending is flagged;
 * 4. every order touched in the last 3 days has a ledger that sums to zero.
 * Safe to run twice: issues are unique by kind and reference.
 */
export async function reconcile(now: Date = new Date(), gateway: PayoutGateway = payoutGateway()): Promise<{ issues: number }> {
  let issues = 0;
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * HOUR);

  // 1. Payments.
  for (const tx of await listTransactions({ from: since, to: now })) {
    let payment = await prisma.payment.findUnique({ where: { reference: tx.reference } });
    if (payment && payment.status !== "SUCCEEDED") {
      try {
        await confirmPayment(tx.reference, now);
      } catch (error) {
        console.error("reconciliation confirm failed", { error: error instanceof Error ? error.name : "unknown" });
      }
      payment = await prisma.payment.findUnique({ where: { reference: tx.reference } });
    }
    if (!payment || payment.status !== "SUCCEEDED") {
      if (await recordIssue("UNCONFIRMED_PAYMENT", tx.reference, payment?.orderId ?? null, { transactionId: tx.transactionId, amountKobo: tx.amountKobo }, tx.amountKobo, now)) issues += 1;
    } else if (koboFromDb(payment.amountKobo) !== tx.amountKobo) {
      const detail = { paymentId: payment.id, expectedKobo: koboFromDb(payment.amountKobo), paystackKobo: tx.amountKobo };
      if (await recordIssue("AMOUNT_MISMATCH", tx.reference, payment.orderId, detail, tx.amountKobo, now)) issues += 1;
    }
  }

  // 2. Transfers awaiting Paystack.
  const sent = await prisma.payoutAttempt.findMany({
    where: { status: "SENT", createdAt: { lt: new Date(now.getTime() - CHECK_AFTER_HOURS * HOUR) } },
    include: { payout: { select: { id: true, orderId: true, amountKobo: true } } },
    take: 500,
  });
  for (const attempt of sent) {
    let checked;
    try {
      checked = await gateway.check(attempt.transferReference);
    } catch (error) {
      console.error("reconciliation transfer check failed", { error: error instanceof Error ? error.name : "unknown" });
      continue;
    }
    if (checked !== "PENDING") {
      await settleAttempt(attempt.transferReference, checked, now, checked === "FAILED" ? "FAILED" : null);
    } else if (attempt.createdAt.getTime() < now.getTime() - STALE_TRANSFER_HOURS * HOUR) {
      const detail = { payoutId: attempt.payout.id, attempt: attempt.attempt, sentAt: attempt.createdAt.toISOString() };
      if (await recordIssue("STALE_TRANSFER", attempt.transferReference, attempt.payout.orderId, detail, koboFromDb(attempt.payout.amountKobo), now)) issues += 1;
    }
  }

  // 3. Refunds.
  const unsent = await prisma.refund.findMany({ where: { status: "PENDING", paystackRefundId: null }, select: { id: true }, take: 500 });
  for (const refund of unsent) {
    try {
      await issueRefund(refund.id);
    } catch (error) {
      console.error("reconciliation refund failed", { error: error instanceof Error ? error.name : "unknown" });
    }
  }
  const stale = await prisma.refund.findMany({
    where: { status: "PENDING", paystackRefundId: { not: null }, createdAt: { lt: new Date(now.getTime() - STALE_REFUND_DAYS * 24 * HOUR) } },
    take: 500,
  });
  for (const refund of stale) {
    if (refund.paystackRefundId?.startsWith("claim:")) continue;
    const detail = { refundId: refund.id, amountKobo: koboFromDb(refund.amountKobo) };
    if (await recordIssue("STALE_REFUND", refund.id, refund.orderId, detail, koboFromDb(refund.amountKobo), now)) issues += 1;
  }

  // 4. Ledgers of orders touched lately.
  const touched = await prisma.ledgerEntry.findMany({ where: { createdAt: { gte: since } }, distinct: ["orderId"], select: { orderId: true }, take: 2000 });
  for (const { orderId } of touched) {
    const sum = await prisma.ledgerEntry.aggregate({ where: { orderId }, _sum: { amountKobo: true } });
    const total = sum._sum.amountKobo ?? BigInt(0);
    if (total !== BigInt(0)) {
      if (await recordIssue("LEDGER_UNBALANCED", orderId, orderId, { sumKobo: total.toString() }, 0, now)) issues += 1;
    }
  }
  return { issues };
}

export type AdminReconciliationIssue = { id: string; kind: string; reference: string; orderId: string | null; createdAt: string };

/** Unresolved reconciliation issues for the admin order queue, oldest first. */
export async function listReconciliationIssues(actor: Actor): Promise<AdminReconciliationIssue[]> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const rows = await prisma.reconciliationIssue.findMany({ where: { resolvedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 });
  return rows.map((r) => ({ id: r.id, kind: r.kind, reference: r.reference, orderId: r.orderId, createdAt: r.createdAt.toISOString() }));
}

/** An admin marks an issue resolved with a note of what they did. Audited. */
export async function resolveReconciliationIssue(actor: Actor, issueId: string, note: string, now: Date = new Date()): Promise<void> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const text = note.trim();
  if (text.length < 5 || text.length > 1000) throw new ValidationError("Write a note", "REASON_REQUIRED");
  const issue = await prisma.reconciliationIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new NotFoundError("ISSUE_NOT_FOUND");
  const { count } = await prisma.reconciliationIssue.updateMany({
    where: { id: issueId, resolvedAt: null },
    data: { resolvedAt: now, resolvedByUserId: actor.userId, resolutionNote: text },
  });
  if (count === 0) throw new ConflictError("Already resolved", "ISSUE_RESOLVED");
  await recordAudit({ actorId: actor.userId, action: "reconciliation.resolve", entity: "reconciliation_issue", entityId: issueId, meta: { issueId, kind: issue.kind } });
}
