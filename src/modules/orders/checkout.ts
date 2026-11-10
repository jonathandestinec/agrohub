import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { koboFromDb, koboToDb, orderSplit } from "@/lib/money";
import { initializeTransaction } from "@/lib/paystack";
import { recordAudit } from "@/modules/audit/audit";
import { committedQuantity, lockLot, lotNegotiationFacts, type NegotiationFacts } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { holdsCooperativeRole } from "@/modules/identity/service";
import { checkoutFactsForOffer } from "@/modules/marketplace/service";
import { startCheckoutInput, type StartCheckoutInput } from "./schema";

export const RESERVATION_MINUTES = 15;
export const UNPAID_ORDER_HOURS = 24;

type Priced = { lot: NegotiationFacts; quantity: number; unitKobo: number; offerId: string | null };

async function lotOnSale(lotId: string, now: Date): Promise<NegotiationFacts> {
  try {
    const lot = await lotNegotiationFacts(lotId, now);
    if (lot.publiclyVisible) return lot;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  throw new ConflictError("Lot is not on sale", "LOT_NOT_AVAILABLE");
}

// What is being bought and at what price per unit: the lot at its asking price, or an accepted
// offer at its agreed price and quantity. An offer must read ACCEPTED to the buyer (an accepted
// offer whose lot went off sale, or whose time to pay passed, reads EXPIRED).
async function priced(actor: Actor, input: StartCheckoutInput, now: Date): Promise<Priced> {
  if (input.source === "OFFER") {
    const offer = await checkoutFactsForOffer(actor, input.offerId, now);
    if (offer.status !== "ACCEPTED") throw new ConflictError("This offer cannot be paid", "OFFER_NOT_PAYABLE");
    const lot = await lotOnSale(offer.lotId, now);
    return { lot, quantity: offer.quantity, unitKobo: offer.agreedKobo, offerId: offer.id };
  }
  const lot = await lotOnSale(input.lotId, now);
  if (input.quantity < lot.minOrderQty) throw new ValidationError("Below the minimum order", "BELOW_MIN_ORDER");
  return { lot, quantity: input.quantity, unitKobo: lot.askKobo, offerId: null };
}

async function usableQuote(actor: Actor, quoteId: string, lotId: string, now: Date): Promise<{ id: string; amountKobo: number }> {
  const quote = await prisma.deliveryQuote.findUnique({ where: { id: quoteId }, include: { order: { select: { id: true } } } });
  if (!quote || quote.buyerUserId !== actor.userId || quote.lotId !== lotId || quote.expiresAt <= now || quote.order) {
    throw new ConflictError("This delivery quote cannot be used", "QUOTE_NOT_USABLE");
  }
  return { id: quote.id, amountKobo: koboFromDb(quote.amountKobo) };
}

/**
 * A buyer starts paying: the quantity is reserved for 15 minutes under the lot's row lock (a
 * checkout from an accepted offer reserves nothing extra, since the offer holds it), an order
 * and a payment are created with the lot's locked terms, and Paystack is asked for a checkout
 * page for 100% of the total. The order is paid only when Paystack's webhook says so.
 */
export async function startCheckout(
  actor: Actor,
  input: StartCheckoutInput,
  now: Date = new Date(),
): Promise<{ orderId: string; authorizationUrl: string }> {
  if (!can(actor, "order:checkout")) throw new ForbiddenError();
  const parsed = startCheckoutInput.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid checkout", "INVALID_CHECKOUT");
  const { lot, quantity, unitKobo, offerId } = await priced(actor, parsed.data, now);
  if (await holdsCooperativeRole(actor.userId, lot.cooperativeId)) throw new ForbiddenError("OWN_COOPERATIVE_LOT");
  if (!lot.feeTerms) throw new ConflictError("This lot has no locked terms", "LOT_TERMS_MISSING");
  const terms = lot.feeTerms;
  const quote = parsed.data.deliveryQuoteId ? await usableQuote(actor, parsed.data.deliveryQuoteId, lot.id, now) : null;
  const split = orderSplit({
    unitKobo,
    quantity,
    cutBps: terms.cooperativeCutBps,
    feeBps: terms.platformFeeBps,
    deliveryKobo: quote?.amountKobo ?? 0,
    contributions: [1],
  });
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });

  let created: { orderId: string; reference: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      await lockLot(tx, lot.id);
      if (offerId) {
        // A new checkout from the same offer replaces an earlier unpaid one, so one offer never
        // has two reservations. A late payment on the old one is re-checked like any other.
        await tx.order.updateMany({
          where: { offerId, status: "PENDING_PAYMENT" },
          data: { status: "CANCELLED", cancelReason: "REPLACED", deliveryQuoteId: null },
        });
      }
      const committed = await committedQuantity(tx, lot.id, now, { offerId: offerId ?? undefined });
      if (quantity > lot.quantity - committed) throw new ConflictError("Not enough stock", "NOT_ENOUGH_STOCK");
      const order = await tx.order.create({
        data: {
          lotId: lot.id,
          cooperativeId: lot.cooperativeId,
          buyerUserId: actor.userId,
          offerId,
          quantity,
          unitKobo,
          cutBps: terms.cooperativeCutBps,
          feeBps: terms.platformFeeBps,
          deliveryMethod: quote ? "DELIVERY" : "PICKUP",
          deliveryKobo: koboToDb(split.deliveryKobo),
          deliveryQuoteId: quote?.id ?? null,
          totalKobo: koboToDb(split.totalKobo),
          createdAt: now,
        },
      });
      await tx.stockReservation.create({
        data: {
          lotId: lot.id,
          orderId: order.id,
          quantity,
          countsTowardStock: offerId === null,
          expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
          createdAt: now,
        },
      });
      const reference = `pay_${order.id}`;
      await tx.payment.create({
        data: { orderId: order.id, reference, amountKobo: koboToDb(split.totalKobo), createdAt: now },
      });
      await recordAudit(
        {
          actorId: actor.userId,
          action: "order.checkout",
          entity: "order",
          entityId: order.id,
          meta: { orderId: order.id, lotId: lot.id, quantity, unitKobo, totalKobo: split.totalKobo },
        },
        tx,
      );
      return { orderId: order.id, reference };
    });
  } catch (error) {
    // Two checkouts naming one quote: the unique key decides.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("This delivery quote cannot be used", "QUOTE_NOT_USABLE");
    }
    throw error;
  }

  try {
    const { authorizationUrl } = await initializeTransaction({
      email: buyer.email,
      amountKobo: split.totalKobo,
      reference: created.reference,
      callbackUrl: `${env.BETTER_AUTH_URL}/buyer/orders/${created.orderId}`,
      metadata: { orderId: created.orderId },
    });
    return { orderId: created.orderId, authorizationUrl };
  } catch (error) {
    // No checkout page: release the stock and the quote at once.
    await prisma.$transaction([
      prisma.stockReservation.deleteMany({ where: { orderId: created.orderId } }),
      prisma.order.updateMany({
        where: { id: created.orderId, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED", cancelReason: "PAYSTACK_UNAVAILABLE", deliveryQuoteId: null },
      }),
    ]);
    throw error;
  }
}
