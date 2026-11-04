import { Prisma } from "@/generated/prisma/client";
import type { MessageSide, ThreadKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { lotNegotiationFacts, type NegotiationFacts } from "@/modules/catalog/service";
import { can, type Actor } from "@/modules/identity/policies";
import { holdsCooperativeRole } from "@/modules/identity/service";
import { hasContactDetails, mentionsAmount } from "./guards";
import { toThreadSummary, toThreadView, type ThreadSummary, type ThreadView } from "./views";

export type { ThreadSummary, ThreadView, ThreadMessage } from "./views";

export const MESSAGE_MAX = 2000;
const MESSAGES_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
const THREAD_MESSAGES = 200;

const THREAD_INCLUDE = {
  lot: { select: { id: true, floorKobo: true, crop: { select: { name: true } }, unit: { select: { name: true } } } },
  cooperative: { select: { name: true } },
  counterpart: { select: { name: true } },
} as const;

type LoadedThread = Prisma.ThreadGetPayload<{ include: typeof THREAD_INCLUDE }>;

const SIDE: Partial<Record<Actor["role"], MessageSide>> = {
  BUYER: "BUYER",
  FARMER: "FARMER",
  OFFICER: "COOPERATIVE",
  ADMIN: "ADMIN",
};

function participates(actor: Actor, thread: { kind: ThreadKind; cooperativeId: string; counterpartUserId: string }): boolean {
  return can(actor, "thread:participate", {
    cooperativeId: thread.cooperativeId,
    ownerUserId: thread.counterpartUserId,
    threadKind: thread.kind,
  });
}

// A thread the actor takes part in; any other looks missing, so ids cannot be probed.
async function loadThread(actor: Actor, threadId: string): Promise<LoadedThread> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId }, include: THREAD_INCLUDE });
  if (!thread || !participates(actor, thread)) throw new NotFoundError("THREAD_NOT_FOUND");
  return thread;
}

async function factsOrNull(lotId: string, now: Date): Promise<NegotiationFacts | null> {
  try {
    return await lotNegotiationFacts(lotId, now);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

// Finds or creates the thread for (lot, kind, counterpart). Two first messages at once may both
// try to create it; the unique key decides and the loser reads the winner's row.
async function ensureThread(lot: NegotiationFacts, kind: ThreadKind, counterpartUserId: string): Promise<string> {
  const key = { lotId_kind_counterpartUserId: { lotId: lot.id, kind, counterpartUserId } };
  try {
    const thread = await prisma.thread.upsert({
      where: key,
      create: { lotId: lot.id, kind, counterpartUserId, cooperativeId: lot.cooperativeId },
      update: {},
      select: { id: true },
    });
    return thread.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return (await prisma.thread.findUniqueOrThrow({ where: key, select: { id: true } })).id;
    }
    throw error;
  }
}

// Opens the lot's thread for the actor: a buyer's own thread with the cooperative (the lot must
// be on sale, and not their own cooperative's); a farmer's thread with the officers about their
// own lot; or, for an officer, that farmer thread on a lot of their cooperative.
export async function openLotThread(actor: Actor, lotId: string, now: Date = new Date()): Promise<{ threadId: string }> {
  const lot = await factsOrNull(lotId, now);
  if (actor.role === "BUYER") {
    if (!can(actor, "thread:participate", { ownerUserId: actor.userId, threadKind: "BUYER_COOPERATIVE" })) {
      throw new ForbiddenError();
    }
    if (!lot || !lot.publiclyVisible) throw new ConflictError("Lot is not on sale", "LOT_NOT_AVAILABLE");
    if (await holdsCooperativeRole(actor.userId, lot.cooperativeId)) throw new ForbiddenError("OWN_COOPERATIVE_LOT");
    return { threadId: await ensureThread(lot, "BUYER_COOPERATIVE", actor.userId) };
  }
  if (actor.role === "FARMER" || actor.role === "OFFICER") {
    const allowed =
      lot !== null &&
      participates(actor, { kind: "FARMER_COOPERATIVE", cooperativeId: lot.cooperativeId, counterpartUserId: lot.farmerUserId });
    if (!lot || !allowed) throw new NotFoundError("LOT_NOT_FOUND");
    return { threadId: await ensureThread(lot, "FARMER_COOPERATIVE", lot.farmerUserId) };
  }
  throw new ForbiddenError();
}

// Checks a message before anything is written: length, contact details, and (for the
// cooperative side or an admin in a buyer thread) the lot's private floor. Shared by
// postMessage and by offer actions that carry a note, so a refused note refuses the action.
export function assertMessageAllowed(
  actor: Actor,
  thread: { kind: ThreadKind; floorKobo: number; quantities?: number[] },
  body: string,
): string {
  const text = body.trim();
  if (text.length < 1 || text.length > MESSAGE_MAX) throw new ValidationError("Message length", "MESSAGE_LENGTH");
  if (hasContactDetails(text)) {
    throw new ValidationError("Messages cannot share phone numbers or emails", "MESSAGE_HAS_CONTACT");
  }
  const cooperativeSide = actor.role === "OFFICER" || actor.role === "ADMIN";
  if (thread.kind === "BUYER_COOPERATIVE" && cooperativeSide && mentionsAmount(text, thread.floorKobo, thread.quantities)) {
    throw new ValidationError("Message names the private floor", "MESSAGE_MENTIONS_FLOOR");
  }
  return text;
}

// The hourly message limit, checked before an action that carries a note changes anything;
// writeMessage checks it again under the author's row lock.
export async function assertMessageRateOk(actor: Actor, now: Date = new Date()): Promise<void> {
  const lastHour = await prisma.message.count({
    where: { authorUserId: actor.userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
  });
  if (lastHour >= MESSAGES_PER_HOUR) throw new ValidationError("Too many messages", "MESSAGE_RATE_LIMIT");
}

async function writeMessage(actor: Actor, threadId: string, text: string, now: Date): Promise<void> {
  const side = SIDE[actor.role];
  if (!side) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${actor.userId} FOR UPDATE`;
    const lastHour = await tx.message.count({
      where: { authorUserId: actor.userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    });
    if (lastHour >= MESSAGES_PER_HOUR) throw new ValidationError("Too many messages", "MESSAGE_RATE_LIMIT");
    await tx.message.create({ data: { threadId, authorUserId: actor.userId, side, body: text, createdAt: now } });
    await tx.thread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
  });
}

// The quantities this buyer has offered for on the lot, so a note naming the floor as a line
// total ("₦550,000 for your 10 bags") is caught too. Read straight from the offer table:
// marketplace imports messaging, not the other way round.
async function offeredQuantities(thread: { kind: ThreadKind; lotId: string; counterpartUserId: string }): Promise<number[]> {
  if (thread.kind !== "BUYER_COOPERATIVE") return [];
  const offers = await prisma.offer.findMany({
    where: { lotId: thread.lotId, buyerUserId: thread.counterpartUserId },
    select: { quantity: true },
    distinct: ["quantity"],
    take: 50,
  });
  return offers.map((offer) => offer.quantity);
}

export async function postMessage(actor: Actor, threadId: string, body: string, now: Date = new Date()): Promise<ThreadView> {
  const thread = await loadThread(actor, threadId);
  const quantities = await offeredQuantities(thread);
  const text = assertMessageAllowed(actor, { kind: thread.kind, floorKobo: thread.lot.floorKobo, quantities }, body);
  await writeMessage(actor, thread.id, text, now);
  return getThread(actor, thread.id);
}

// For offer actions: posts a note to the lot's thread between the cooperative and this buyer,
// creating it if needed. Callers run assertMessageAllowed before their own change.
export async function postToBuyerThread(
  actor: Actor,
  lotId: string,
  buyerUserId: string,
  body: string,
  now: Date = new Date(),
): Promise<void> {
  const lot = await lotNegotiationFacts(lotId, now);
  const threadId = await ensureThread(lot, "BUYER_COOPERATIVE", buyerUserId);
  const thread = await loadThread(actor, threadId);
  const quantities = await offeredQuantities(thread);
  const text = assertMessageAllowed(actor, { kind: thread.kind, floorKobo: thread.lot.floorKobo, quantities }, body);
  await writeMessage(actor, thread.id, text, now);
}

export async function getThread(actor: Actor, threadId: string): Promise<ThreadView> {
  const thread = await loadThread(actor, threadId);
  const latest = await prisma.message.findMany({
    where: { threadId: thread.id },
    include: { author: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: THREAD_MESSAGES,
  });
  return toThreadView(thread, latest.reverse(), actor);
}

// The threads the actor takes part in, newest activity first: a buyer's or farmer's own, an
// officer's cooperative's, or (for an admin) the latest 100 anywhere.
export async function listOwnThreads(actor: Actor): Promise<ThreadSummary[]> {
  let where: Prisma.ThreadWhereInput;
  if (actor.role === "BUYER") where = { kind: "BUYER_COOPERATIVE", counterpartUserId: actor.userId };
  else if (actor.role === "FARMER" && actor.cooperativeId) {
    where = { kind: "FARMER_COOPERATIVE", counterpartUserId: actor.userId, cooperativeId: actor.cooperativeId };
  } else if (actor.role === "OFFICER" && actor.cooperativeId) where = { cooperativeId: actor.cooperativeId };
  else if (actor.role === "ADMIN") where = {};
  else throw new ForbiddenError();
  const threads = await prisma.thread.findMany({
    where,
    include: { ...THREAD_INCLUDE, messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
    orderBy: [{ lastMessageAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return threads.filter((t) => participates(actor, t)).map((t) => toThreadSummary(t, t.messages[0], actor));
}

// The thread between a lot's cooperative and one buyer, if it exists and the actor takes part.
export async function findBuyerThreadId(actor: Actor, lotId: string, buyerUserId: string): Promise<string | null> {
  const thread = await prisma.thread.findUnique({
    where: { lotId_kind_counterpartUserId: { lotId, kind: "BUYER_COOPERATIVE", counterpartUserId: buyerUserId } },
  });
  return thread && participates(actor, thread) ? thread.id : null;
}

// The farmer thread of a lot, if it exists and the actor takes part.
export async function findFarmerThreadId(actor: Actor, lotId: string, farmerUserId: string): Promise<string | null> {
  const thread = await prisma.thread.findUnique({
    where: { lotId_kind_counterpartUserId: { lotId, kind: "FARMER_COOPERATIVE", counterpartUserId: farmerUserId } },
  });
  return thread && participates(actor, thread) ? thread.id : null;
}

// ---------------------------------------------------------------------------------------------
// Phase 5: order services use the buyer's lot thread as the order thread. These are system
// functions with no Actor: only order services call them, after their own can() check.

/** The buyer's thread with the lot's cooperative, created if needed, whether or not the lot is on sale. */
export async function ensureBuyerThread(lotId: string, buyerUserId: string): Promise<string> {
  const lot = await lotNegotiationFacts(lotId);
  return ensureThread(lot, "BUYER_COOPERATIVE", buyerUserId);
}

/** The buyer's thread on a lot, if it exists. */
export async function buyerThreadIdOf(lotId: string, buyerUserId: string): Promise<string | null> {
  const thread = await prisma.thread.findUnique({
    where: { lotId_kind_counterpartUserId: { lotId, kind: "BUYER_COOPERATIVE", counterpartUserId: buyerUserId } },
    select: { id: true },
  });
  return thread?.id ?? null;
}

/**
 * Writes text the caller composed (for example a delivery quote line) as the actor, under the
 * hourly limit. The caller has already checked the actor may post and passed any free text it
 * contains through assertMessageAllowed.
 */
export async function writeComposedMessage(actor: Actor, threadId: string, text: string, now: Date = new Date()): Promise<void> {
  if (text.length < 1 || text.length > MESSAGE_MAX) throw new ValidationError("Message length", "MESSAGE_LENGTH");
  await writeMessage(actor, threadId, text, now);
}

/** An AgroHub line in a thread (side ADMIN, shown as "AgroHub"), recorded as written by the user whose action caused it. */
export async function postSystemMessage(threadId: string, causedByUserId: string, text: string, now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.message.create({ data: { threadId, authorUserId: causedByUserId, side: "ADMIN", body: text, createdAt: now } });
    await tx.thread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
  });
}
