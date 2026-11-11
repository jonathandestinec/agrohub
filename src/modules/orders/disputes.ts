import type { DisputeOutcome, LedgerAccount, OrderStatus, PayoutRecipient, PayoutStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { koboFromDb } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { assertMessageAllowed, buyerThreadIdOf, ensureBuyerThread, getThread, postSystemMessage } from "@/modules/messaging/service";
import type { ThreadMessage } from "@/modules/messaging/views";
import { ledgerBalance, listPayoutIssues, listReconciliationIssues } from "@/modules/payments/service";
import { notifyOrder } from "./alerts";
import { refundInFull } from "./cancel";
import { completeOrder } from "./complete";
import { loadOwnOrder } from "./delivery";
import { isOpenOrder } from "./state";
import { orderReference } from "./views";

export const AUTO_RELEASE_HOURS = 72;
export const DELIVERY_TIMEOUT_DAYS = 14;

const REASON_MIN = 5;
const REASON_MAX = 1000;
const REPORTABLE: readonly OrderStatus[] = ["PAID_HELD", "PREPARING", "DELIVERED_MARKED"];

export type DisputeKind = "REPORT" | "TIMEOUT" | "SUSPENSION" | "AFTER_COMPLETION";

async function postLine(order: { lotId: string; buyerUserId: string }, causedByUserId: string, text: string, now: Date) {
  const threadId = await ensureBuyerThread(order.lotId, order.buyerUserId);
  await postSystemMessage(threadId, causedByUserId, text, now);
}

function cleanText(actor: Actor, floorKobo: number, text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) throw new ValidationError("Give a reason", "REASON_REQUIRED");
  return assertMessageAllowed(actor, { kind: "BUYER_COOPERATIVE", floorKobo }, trimmed);
}

/**
 * The buyer reports a problem. Before completion the payment is frozen for an admin (DISPUTED:
 * no confirmation, no auto-release, no cooperative action). After completion it is a note for
 * the admin queue with no money action (loss after release is out of scope, spec 12).
 */
export async function reportProblem(actor: Actor, orderId: string, reason: string, now: Date = new Date()): Promise<void> {
  const order = await loadOwnOrder(actor, orderId);
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: order.lotId }, select: { floorKobo: true } });
  const text = cleanText(actor, lot.floorKobo, reason);
  let kind: DisputeKind;
  if (REPORTABLE.includes(order.status)) {
    kind = "REPORT";
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: "DISPUTED" } });
      if (count === 0) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
      await tx.dispute.create({ data: { orderId, openedByUserId: actor.userId, kind, reason: text, createdAt: now } });
    });
  } else if (order.status === "COMPLETED") {
    kind = "AFTER_COMPLETION";
    await prisma.dispute.create({ data: { orderId, openedByUserId: actor.userId, kind, reason: text, createdAt: now } });
  } else {
    throw new ConflictError("The order cannot do that now", "ORDER_STATE");
  }
  await postLine(order, actor.userId, `The buyer reported a problem: ${text}`, now);
  await recordAudit({ actorId: actor.userId, action: "order.dispute_open", entity: "order", entityId: orderId, meta: { orderId, kind } });
  // Last: both branches wrote a dispute row by here.
  await notifyOrder(prisma, orderId, "ORDER_PROBLEM_REPORTED", ["officers", "admins"], actor.userId);
}

/**
 * System function, no Actor: the daily order-timers job. Releases orders 72 hours after the
 * delivery mark (the buyer did not confirm or report), and hands an order paid 14 days ago and
 * never marked delivered to an admin (TIMED_OUT). Safe to run twice.
 */
export async function runOrderTimers(now: Date = new Date()): Promise<{ released: number; timedOut: number }> {
  const releaseBefore = new Date(now.getTime() - AUTO_RELEASE_HOURS * 3_600_000);
  const due = await prisma.order.findMany({
    where: { status: "DELIVERED_MARKED", deliveredMarkedAt: { lte: releaseBefore } },
    select: { id: true },
    orderBy: { deliveredMarkedAt: "asc" },
    take: 500,
  });
  let released = 0;
  for (const { id } of due) {
    try {
      if (await completeOrder(id, "AUTO", now)) released += 1;
    } catch (error) {
      console.error("auto-release failed", { orderId: id, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  const timeoutBefore = new Date(now.getTime() - DELIVERY_TIMEOUT_DAYS * 24 * 3_600_000);
  const late = await prisma.order.findMany({
    where: { status: { in: ["PAID_HELD", "PREPARING"] }, paidAt: { lte: timeoutBefore } },
    select: { id: true, status: true, lotId: true, buyerUserId: true, cooperativeId: true },
    take: 500,
  });
  let timedOut = 0;
  for (const order of late) {
    const moved = await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "TIMED_OUT", timedOutAt: now } });
      if (count === 0) return false;
      await tx.dispute.create({
        data: { orderId: order.id, kind: "TIMEOUT", reason: `No delivery marked ${DELIVERY_TIMEOUT_DAYS} days after payment.`, createdAt: now },
      });
      await recordAudit({ actorId: null, action: "order.timed_out", entity: "order", entityId: order.id, meta: { orderId: order.id } }, tx);
      return true;
    });
    if (!moved) continue;
    timedOut += 1;
    const officer = await anyOfficer(order.cooperativeId);
    if (officer) await postLine(order, officer, "No delivery was marked within 14 days of payment. AgroHub is reviewing this order.", now);
  }
  return { released, timedOut };
}

// System thread lines need an author; for job lines that is one of the cooperative's officers
// (the line itself reads as AgroHub).
async function anyOfficer(cooperativeId: string): Promise<string | null> {
  const m = await prisma.membership.findFirst({ where: { cooperativeId, role: "OFFICER" }, select: { userId: true }, orderBy: { createdAt: "asc" } });
  return m?.userId ?? null;
}

/**
 * Inside suspendCooperative: every open order of the cooperative is frozen (DISPUTED) and gets a
 * SUSPENSION dispute, so an admin decides whether it is refunded or released. Never a payout to
 * a suspended cooperative without an admin's decision.
 */
export async function freezeOrdersOfCooperative(cooperativeId: string, adminUserId: string, now: Date = new Date()): Promise<number> {
  const open = await prisma.order.findMany({
    where: { cooperativeId, status: { in: ["PAID_HELD", "PREPARING", "DELIVERED_MARKED", "DISPUTED", "TIMED_OUT"] } },
    select: { id: true, status: true },
  });
  for (const order of open) {
    await prisma.$transaction(async (tx) => {
      if (order.status !== "DISPUTED" && order.status !== "TIMED_OUT") {
        const { count } = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: "DISPUTED" } });
        if (count === 0) return;
      }
      await tx.dispute.create({
        data: { orderId: order.id, openedByUserId: adminUserId, kind: "SUSPENSION", reason: "The cooperative was suspended.", createdAt: now },
      });
    });
  }
  return open.length;
}

export type DisputeDecision = { outcome: DisputeOutcome; unitsRefunded?: number; note: string };

/**
 * An admin decides a dispute: release in full, refund in full, refund some units and release
 * the rest (the shortfall arithmetic), or (for a report after completion, or a suspension with
 * nothing left to move) a note. Every decision is audited; the other open disputes of the order
 * close with it.
 */
export async function resolveDispute(actor: Actor, disputeId: string, decision: DisputeDecision, now: Date = new Date()): Promise<void> {
  if (!can(actor, "dispute:resolve")) throw new ForbiddenError();
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { order: true } });
  if (!dispute) throw new NotFoundError("DISPUTE_NOT_FOUND");
  if (dispute.status !== "OPEN") throw new ConflictError("This dispute is decided", "DISPUTE_RESOLVED");
  const note = decision.note.trim();
  if (note.length < REASON_MIN || note.length > REASON_MAX) throw new ValidationError("Write a note", "REASON_REQUIRED");
  const order = dispute.order;
  const frozen = order.status === "DISPUTED" || order.status === "TIMED_OUT";
  let unitsRefunded: number | null = null;
  // Claim the dispute first, so two admins deciding at once decide once.
  const claim = await prisma.dispute.updateMany({
    where: { id: disputeId, status: "OPEN" },
    data: { status: "RESOLVED", outcome: decision.outcome, decisionNote: note, decidedByUserId: actor.userId, decidedAt: now },
  });
  if (claim.count === 0) throw new ConflictError("This dispute is decided", "DISPUTE_RESOLVED");
  try {
    switch (decision.outcome) {
      case "NOTE":
        if (frozen || isOpenOrder(order.status)) throw new ConflictError("Decide what happens to the money", "OUTCOME_NOT_ALLOWED");
        break;
      case "RELEASE":
        if (!frozen) throw new ConflictError("This order is not waiting for a decision", "OUTCOME_NOT_ALLOWED");
        if (!(await completeOrder(order.id, "ADMIN", now))) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
        break;
      case "REFUND_ALL":
        if (!frozen) throw new ConflictError("This order is not waiting for a decision", "OUTCOME_NOT_ALLOWED");
        await refundInFull({
          orderId: order.id,
          from: ["DISPUTED", "TIMED_OUT"],
          reason: "ADMIN_DECISION",
          purpose: "dispute",
          by: "ADMIN",
          actorUserId: actor.userId,
          now,
        });
        break;
      case "REFUND_UNITS": {
        if (!frozen) throw new ConflictError("This order is not waiting for a decision", "OUTCOME_NOT_ALLOWED");
        const delivered = order.deliveredQuantity ?? order.quantity;
        const units = decision.unitsRefunded ?? 0;
        if (!Number.isSafeInteger(units) || units < 1 || units > delivered - 1) throw new ValidationError("Units out of range", "UNITS_RANGE");
        unitsRefunded = units;
        if (!(await completeOrder(order.id, "ADMIN", now, units))) throw new ConflictError("The order cannot do that now", "ORDER_STATE");
        break;
      }
    }
  } catch (error) {
    // Nothing moved: the dispute stays open for another decision.
    await prisma.dispute.updateMany({
      where: { id: disputeId, decidedAt: now, decidedByUserId: actor.userId },
      data: { status: "OPEN", outcome: null, decisionNote: null, decidedByUserId: null, decidedAt: null },
    });
    throw error;
  }
  await prisma.dispute.update({ where: { id: disputeId }, data: { unitsRefunded } });
  if (decision.outcome !== "NOTE") {
    await prisma.dispute.updateMany({
      where: { orderId: order.id, status: "OPEN" },
      data: { status: "RESOLVED", outcome: decision.outcome, decisionNote: note, decidedByUserId: actor.userId, decidedAt: now },
    });
    await postLine(order, actor.userId, `AgroHub decided: ${DECISION_LINE[decision.outcome]}`, now);
  }
  await recordAudit({
    actorId: actor.userId,
    action: "dispute.resolve",
    entity: "dispute",
    entityId: disputeId,
    meta: { disputeId, orderId: order.id, outcome: decision.outcome, unitsRefunded },
  });
  // Last, after the try/catch (a decision that failed and was reverted tells no one) and after the
  // other disputes are closed, the thread line is posted and the audit row is written.
  await notifyOrder(prisma, order.id, "DISPUTE_RESOLVED", ["buyer", "officers"], actor.userId);
}

const DECISION_LINE: Record<DisputeOutcome, string> = {
  RELEASE: "the payment is released to the cooperative and its farmers.",
  REFUND_ALL: "the buyer is refunded in full.",
  REFUND_UNITS: "part of the order is refunded to the buyer and the rest is released.",
  NOTE: "noted.",
};

/** System step of markDelivered: a late delivery mark closes the order's timeout. */
export async function closeTimeout(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
  await tx.dispute.updateMany({
    where: { orderId, kind: "TIMEOUT", status: "OPEN" },
    data: { status: "RESOLVED", outcome: "NOTE", decisionNote: "The cooperative marked delivery after the timeout.", decidedAt: now },
  });
}

// ---- The admin order queue. ----

export type AdminQueueKind = DisputeKind | "PAYOUT" | "RECONCILIATION";

export type AdminQueueItem = {
  kind: AdminQueueKind;
  id: string;
  orderId: string | null;
  orderReference: string | null;
  detail: string | null;
  since: string;
};

/** Everything waiting for an admin, oldest first: disputes, payout problems and reconciliation issues. */
export async function listOrderQueue(actor: Actor, now: Date = new Date()): Promise<AdminQueueItem[]> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const disputes = await prisma.dispute.findMany({ where: { status: "OPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 });
  const items: AdminQueueItem[] = disputes.map((d) => ({
    kind: d.kind as DisputeKind,
    id: d.id,
    orderId: d.orderId,
    orderReference: orderReference(d.orderId),
    detail: d.reason,
    since: d.createdAt.toISOString(),
  }));
  for (const p of await listPayoutIssues(actor, now)) {
    items.push({ kind: "PAYOUT", id: p.id, orderId: p.orderId, orderReference: p.orderReference, detail: p.status, since: p.createdAt });
  }
  for (const r of await listReconciliationIssues(actor)) {
    items.push({ kind: "RECONCILIATION", id: r.id, orderId: r.orderId, orderReference: r.orderId ? orderReference(r.orderId) : null, detail: r.kind, since: r.createdAt });
  }
  return items.sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

export type AdminOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  cooperativeName: string;
  buyerName: string;
  crop: string;
  unit: string;
  quantity: number;
  deliveredQuantity: number | null;
  unitKobo: number;
  totalKobo: number;
  paidAt: string | null;
  deliveredMarkedAt: string | null;
  completedAt: string | null;
  messages: ThreadMessage[];
  ledger: Record<LedgerAccount, number>;
  payouts: Array<{ id: string; recipientType: PayoutRecipient; part: number; amountKobo: number; status: PayoutStatus; paidAt: string | null }>;
  refunds: Array<{ amountKobo: number; reason: string; status: string }>;
  disputes: Array<{ id: string; kind: string; reason: string; status: string; outcome: DisputeOutcome | null; decisionNote: string | null; createdAt: string }>;
};

const ACCOUNTS: LedgerAccount[] = ["PAYSTACK_BALANCE", "HELD", "COOPERATIVE_PAYABLE", "FARMER_PAYABLE", "PLATFORM_FEE", "PAYSTACK_FEES", "REFUND_PAYABLE"];

/** An admin's view of one order: its thread, delivery marks, ledger totals, payouts and disputes. No bank data. */
export async function getOrderForAdmin(actor: Actor, orderId: string): Promise<AdminOrder> {
  if (!can(actor, "order:admin")) throw new ForbiddenError();
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      cooperative: { select: { name: true } },
      buyer: { select: { name: true } },
      lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
      payouts: { orderBy: [{ recipientType: "asc" }, { part: "asc" }] },
      refunds: true,
      disputes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw new NotFoundError("ORDER_NOT_FOUND");
  const threadId = await buyerThreadIdOf(order.lotId, order.buyerUserId);
  const thread = threadId ? await getThread(actor, threadId) : null;
  const ledger = Object.fromEntries(
    await Promise.all(ACCOUNTS.map(async (account) => [account, await ledgerBalance(order.id, account)] as const)),
  ) as Record<LedgerAccount, number>;
  return {
    id: order.id,
    reference: orderReference(order.id),
    status: order.status,
    cooperativeName: order.cooperative.name,
    buyerName: order.buyer.name,
    crop: order.lot.crop.name,
    unit: order.lot.unit.name,
    quantity: order.quantity,
    deliveredQuantity: order.deliveredQuantity,
    unitKobo: order.unitKobo,
    totalKobo: koboFromDb(order.totalKobo),
    paidAt: order.paidAt?.toISOString() ?? null,
    deliveredMarkedAt: order.deliveredMarkedAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    messages: thread?.messages ?? [],
    ledger,
    payouts: order.payouts.map((p) => ({
      id: p.id,
      recipientType: p.recipientType,
      part: p.part,
      amountKobo: koboFromDb(p.amountKobo),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
    refunds: order.refunds.map((r) => ({ amountKobo: koboFromDb(r.amountKobo), reason: r.reason, status: r.status })),
    disputes: order.disputes.map((d) => ({
      id: d.id,
      kind: d.kind,
      reason: d.reason,
      status: d.status,
      outcome: d.outcome,
      decisionNote: d.decisionNote,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}
