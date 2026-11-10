import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatLagosDateTime } from "@/lib/lagos-date";
import { formatNaira, koboFromDb, koboToDb } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { lotNegotiationFacts } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { assertMessageAllowed, buyerThreadIdOf, threadParties, writeComposedMessage } from "@/modules/messaging/service";
import { buyer, notify } from "@/modules/notifications/service";

export const QUOTE_TTL_HOURS = 48;
// A delivery cost is at most ₦10,000,000, so the cooperative's payout never needs more than
// one extra transfer part for it.
const QUOTE_MAX_KOBO = 1_000_000_000;
const NOTE_MAX = 500;

export type UsableQuote = { id: string; amountKobo: number; note: string | null; expiresAt: string };

// An officer quotes a buyer the cost of delivering a lot. The quote shows in the buyer's lot
// thread as the cooperative and becomes a choice at that buyer's checkout for 48 hours.
export async function quoteDelivery(
  actor: Actor,
  input: { lotId: string; buyerUserId: string; amountKobo: number; note?: string },
  now: Date = new Date(),
): Promise<{ quoteId: string }> {
  let lot;
  try {
    lot = await lotNegotiationFacts(input.lotId, now);
  } catch (error) {
    if (error instanceof NotFoundError) throw new ForbiddenError();
    throw error;
  }
  if (!can(actor, "quote:make", { cooperativeId: lot.cooperativeId })) throw new ForbiddenError();
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo < 1 || input.amountKobo > QUOTE_MAX_KOBO) {
    throw new ValidationError("Delivery cost out of range", "QUOTE_RANGE");
  }
  const threadId = await buyerThreadIdOf(lot.id, input.buyerUserId);
  if (!threadId) throw new ValidationError("No conversation with this buyer", "NO_BUYER_THREAD");
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note) {
    if (note.length > NOTE_MAX) throw new ValidationError("Note too long", "MESSAGE_LENGTH");
    // The note is free text from the officer, so it gets every message guard. The amount line
    // below is composed here and is a delivery cost, not a price.
    assertMessageAllowed(actor, { kind: "BUYER_COOPERATIVE", floorKobo: lot.floorKobo }, note);
  }
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_HOURS * 3_600_000);
  const line = `Delivery quote: ${formatNaira(input.amountKobo)}, valid until ${formatLagosDateTime(expiresAt)}.`;
  await writeComposedMessage(actor, threadId, note ? `${line}\n${note}` : line, now);
  const quote = await prisma.deliveryQuote.create({
    data: {
      lotId: lot.id,
      cooperativeId: lot.cooperativeId,
      buyerUserId: input.buyerUserId,
      amountKobo: koboToDb(input.amountKobo),
      note,
      quotedByUserId: actor.userId,
      expiresAt,
      createdAt: now,
    },
  });
  await recordAudit({
    actorId: actor.userId,
    action: "quote.make",
    entity: "delivery_quote",
    entityId: quote.id,
    meta: { quoteId: quote.id, lotId: lot.id, amountKobo: input.amountKobo },
  });
  // Covers both quoteDelivery and quoteDeliveryInThread, which calls this. The amount is not
  // in the alert, and the quote line in the thread raises no message alert on top of it.
  const named = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id }, select: { crop: { select: { name: true } } } });
  await notify(prisma, {
    kind: "DELIVERY_QUOTED",
    subject: { type: "THREAD", id: threadId },
    data: { crop: named.crop.name },
    to: [buyer(input.buyerUserId)],
    exclude: actor.userId,
  });
  return { quoteId: quote.id };
}

// The buyer's own quotes on a lot that are still valid and not used by an order.
export async function listUsableQuotes(actor: Actor, lotId: string, now: Date = new Date()): Promise<UsableQuote[]> {
  if (!can(actor, "order:checkout")) throw new ForbiddenError();
  const quotes = await prisma.deliveryQuote.findMany({
    where: { lotId, buyerUserId: actor.userId, expiresAt: { gt: now }, order: null },
    orderBy: { createdAt: "desc" },
  });
  return quotes.map((q) => ({
    id: q.id,
    amountKobo: koboFromDb(q.amountKobo),
    note: q.note,
    expiresAt: q.expiresAt.toISOString(),
  }));
}

// The officer quotes from the buyer thread they are reading.
export async function quoteDeliveryInThread(
  actor: Actor,
  threadId: string,
  input: { amountKobo: number; note?: string },
  now: Date = new Date(),
): Promise<{ quoteId: string }> {
  const thread = await threadParties(threadId);
  if (!thread || thread.kind !== "BUYER_COOPERATIVE" || !can(actor, "quote:make", { cooperativeId: thread.cooperativeId })) {
    throw new NotFoundError("THREAD_NOT_FOUND");
  }
  return quoteDelivery(actor, { lotId: thread.lotId, buyerUserId: thread.counterpartUserId, ...input }, now);
}
