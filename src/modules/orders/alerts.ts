import {
  activeAdmins,
  buyer,
  farmersOfLot,
  notify,
  officersOf,
  type Db,
  type Recipient,
} from "@/modules/notifications/service";

// Alerts about an order. The alert carries the crop, quantity and unit only: no price.
type QtyKind =
  | "ORDER_PAID"
  | "ORDER_RECEIPT_CONFIRMED"
  | "ORDER_PROBLEM_REPORTED"
  | "ORDER_CANCELLED_BY_BUYER"
  | "ORDER_CANCEL_REQUESTED"
  | "DISPUTE_RESOLVED"
  | "LOT_ORDER_PAID"
  | "PAYMENT_CONFIRMED"
  | "ORDER_PREPARING"
  | "ORDER_DELIVERED"
  | "ORDER_EXPIRED"
  | "ORDER_CANCELLED_BY_COOPERATIVE"
  | "CANCEL_REQUEST_AGREED"
  | "CANCEL_REQUEST_REFUSED";

export type OrderAudience = "buyer" | "officers" | "admins" | "farmers";

async function loadOrderFacts(db: Db, orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      lotId: true,
      buyerUserId: true,
      cooperativeId: true,
      quantity: true,
      lot: { select: { crop: { select: { name: true } }, unit: { select: { name: true } } } },
    },
  });
}

async function recipientsOf(
  db: Db,
  order: { lotId: string; buyerUserId: string; cooperativeId: string },
  audience: OrderAudience[],
): Promise<Recipient[]> {
  const lists: Recipient[][] = [];
  if (audience.includes("buyer")) lists.push([buyer(order.buyerUserId)]);
  if (audience.includes("officers")) lists.push(await officersOf(db, order.cooperativeId));
  if (audience.includes("admins")) lists.push(await activeAdmins(db));
  if (audience.includes("farmers")) lists.push(await farmersOfLot(db, order.lotId));
  return lists.flat();
}

// Writes an order alert for the given audience. Call it in the caller's transaction, or straight
// after a conditional update that changed one row; `exclude` is the acting user.
export async function notifyOrder(
  db: Db,
  orderId: string,
  kind: QtyKind,
  audience: OrderAudience[],
  exclude?: string | null,
): Promise<void> {
  const order = await loadOrderFacts(db, orderId);
  await notify(db, {
    kind,
    subject: { type: "ORDER", id: order.id },
    data: { crop: order.lot.crop.name, quantity: order.quantity, unit: order.lot.unit.name },
    to: await recipientsOf(db, order, audience),
    exclude,
  });
}

// The buyer is told a delivery or pickup date was set or changed.
export async function notifyDeliveryDate(
  db: Db,
  orderId: string,
  date: string,
  exclude?: string | null,
): Promise<void> {
  const order = await loadOrderFacts(db, orderId);
  await notify(db, {
    kind: "DELIVERY_DATE_SET",
    subject: { type: "ORDER", id: order.id },
    data: { crop: order.lot.crop.name, quantity: order.quantity, unit: order.lot.unit.name, date },
    to: await recipientsOf(db, order, ["buyer"]),
    exclude,
  });
}
