import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, type Actor } from "@/modules/identity/policies";
import { buyerThreadIdOf } from "@/modules/messaging/service";
import { toBuyerOrder, type BuyerOrder } from "./views";

// What every order view loads with the order: the lot's names (never its floor or farmer),
// the reservation and the refunds.
const ORDER_INCLUDE = {
  lot: {
    select: {
      id: true,
      crop: { select: { name: true } },
      unit: { select: { name: true } },
      cooperative: { select: { name: true } },
    },
  },
  reservation: { select: { expiresAt: true } },
  refunds: { select: { amountKobo: true, status: true } },
} as const;

type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

function loadOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
}

async function buyerView(order: LoadedOrder, now: Date): Promise<BuyerOrder> {
  const lot = {
    id: order.lot.id,
    crop: order.lot.crop.name,
    unit: order.lot.unit.name,
    cooperativeName: order.lot.cooperative.name,
  };
  return toBuyerOrder(order, lot, await buyerThreadIdOf(order.lotId, order.buyerUserId), now);
}

// The buyer's own order; another buyer's order and a missing one look the same.
export async function getOwnOrder(actor: Actor, orderId: string, now: Date = new Date()): Promise<BuyerOrder> {
  const order = await loadOrder(orderId);
  if (!order || !can(actor, "order:own", { ownerUserId: order.buyerUserId })) throw new NotFoundError("ORDER_NOT_FOUND");
  return buyerView(order, now);
}

export async function listOwnOrders(actor: Actor, now: Date = new Date()): Promise<BuyerOrder[]> {
  if (!can(actor, "order:own", { ownerUserId: actor.userId })) throw new ForbiddenError();
  const orders = await prisma.order.findMany({
    where: { buyerUserId: actor.userId },
    include: ORDER_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
  });
  return Promise.all(orders.map((order) => buyerView(order, now)));
}
