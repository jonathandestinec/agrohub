import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import { openLotThread } from "@/modules/messaging/service";
import {
  answerCancelRequest,
  cancelOrder,
  confirmReceipt,
  expireUnpaidOrders,
  markDelivered,
  quoteDelivery,
  quoteDeliveryInThread,
  reportProblem,
  resolveDispute,
  runOrderTimers,
  setDeliveryDate,
  startPreparing,
} from "@/modules/orders/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase } from "./helpers";
import { seedOrder } from "./order-fixtures";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;
let orderId: string;

const QTY = { crop: "Maize", quantity: 10, unit: "Bag" };
const clearAlerts = () => prisma.notification.deleteMany();
const kindsOf = async (userId: string) => (await alertKinds(userId)).sort();

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await paidWorld();
  // lotWorld gives the admin no membership row, and alerts go to membership holders.
  await prisma.membership.create({ data: { userId: w.admin.userId, role: "ADMIN", status: "ACTIVE" } });
  orderId = (await paidOrder(w, 10)).orderId;
  await clearAlerts();
});

afterAll(cleanDatabase);

describe("order alerts for the buyer", () => {
  it("tells_the_buyer_preparation_started", async () => {
    await startPreparing(w.officer, orderId);
    expect(await kindsOf(w.buyer.userId)).toEqual(["ORDER_PREPARING"]);
    expect(await kindsOf(w.officer.userId)).toEqual([]);
    expect(await alertsFor(w.buyer.userId)).toMatchObject([
      { role: "BUYER", subjectType: "ORDER", subjectId: orderId, data: QTY },
    ]);
  });

  it("tells_the_buyer_the_delivery_date", async () => {
    await setDeliveryDate(w.officer, orderId, "2026-12-01");
    await setDeliveryDate(w.officer, orderId, "2026-12-05");
    expect(await kindsOf(w.buyer.userId)).toEqual(["DELIVERY_DATE_SET", "DELIVERY_DATE_SET"]);
    const dates = (await alertsFor(w.buyer.userId)).map((r) => (r.data as { date: string }).date).sort();
    expect(dates).toEqual(["2026-12-01", "2026-12-05"]);
  });

  it("tells_the_buyer_the_order_was_marked_delivered", async () => {
    await markDelivered(w.officer, orderId, 10);
    expect(await kindsOf(w.buyer.userId)).toEqual(["ORDER_DELIVERED"]);
  });

  it("tells_the_buyer_the_cooperative_cancelled", async () => {
    await cancelOrder(w.officer, orderId, "Out of stock");
    expect(await alertKinds(w.buyer.userId)).toContain("ORDER_CANCELLED_BY_COOPERATIVE");
    expect(await alertKinds(w.officer.userId)).toEqual([]);
  });

  it("tells_the_buyer_their_cancel_request_was_agreed", async () => {
    await startPreparing(w.officer, orderId);
    await cancelOrder(w.buyer, orderId, "Plans changed");
    await clearAlerts();
    await answerCancelRequest(w.officer, orderId, true);
    expect(await alertKinds(w.buyer.userId)).toContain("CANCEL_REQUEST_AGREED");
    expect(await alertKinds(w.buyer.userId)).not.toContain("ORDER_CANCELLED_BY_COOPERATIVE");
  });

  it("tells_the_buyer_their_cancel_request_was_refused", async () => {
    await startPreparing(w.officer, orderId);
    await cancelOrder(w.buyer, orderId, "Plans changed");
    await clearAlerts();
    await answerCancelRequest(w.officer, orderId, false);
    expect(await kindsOf(w.buyer.userId)).toEqual(["CANCEL_REQUEST_REFUSED"]);
  });

  it("tells_the_buyer_their_unpaid_order_expired_once", async () => {
    const unpaid = await seedOrder({
      lotId: w.lotId,
      buyerUserId: w.buyer.userId,
      quantity: 5,
      status: "PENDING_PAYMENT",
    });
    await prisma.order.update({ where: { id: unpaid }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    await expireUnpaidOrders(new Date());
    await expireUnpaidOrders(new Date());
    expect(await kindsOf(w.buyer.userId)).toEqual(["ORDER_EXPIRED"]);
    expect(await alertsFor(w.buyer.userId)).toMatchObject([{ subjectId: unpaid, data: { ...QTY, quantity: 5 } }]);
  });

  it.each(["quoteDelivery", "quoteDeliveryInThread"] as const)(
    "tells_the_buyer_a_delivery_price_was_quoted_with_%s",
    async (how) => {
      await openLotThread(w.buyer, w.lotId);
      const thread = await prisma.thread.findFirstOrThrow({ where: { lotId: w.lotId, kind: "BUYER_COOPERATIVE" } });
      await clearAlerts();
      if (how === "quoteDelivery") {
        await quoteDelivery(w.officer, { lotId: w.lotId, buyerUserId: w.buyer.userId, amountKobo: 250_000 });
      } else {
        await quoteDeliveryInThread(w.officer, thread.id, { amountKobo: 250_000 });
      }
      expect(await kindsOf(w.buyer.userId)).toEqual(["DELIVERY_QUOTED"]);
      expect(await alertsFor(w.buyer.userId)).toMatchObject([
        { subjectType: "THREAD", subjectId: thread.id, data: { crop: "Maize" } },
      ]);
    },
  );
});

describe("order alerts for officers and admins", () => {
  it("tells_officers_the_buyer_confirmed_receipt", async () => {
    await markDelivered(w.officer, orderId, 10);
    await clearAlerts();
    await confirmReceipt(w.buyer, orderId);
    expect(await kindsOf(w.officer.userId)).toEqual(["ORDER_RECEIPT_CONFIRMED"]);
    expect(await kindsOf(w.buyer.userId)).toEqual([]);
  });

  it("does_not_tell_officers_when_an_order_completes_by_timer", async () => {
    await markDelivered(w.officer, orderId, 10, new Date(Date.now() - 80 * HOUR));
    await clearAlerts();
    const result = await runOrderTimers(new Date());
    expect(result.released).toBe(1);
    expect(await alertKinds(w.officer.userId)).not.toContain("ORDER_RECEIPT_CONFIRMED");
  });

  it("tells_officers_and_admins_a_problem_was_reported", async () => {
    await markDelivered(w.officer, orderId, 10);
    await clearAlerts();
    await reportProblem(w.buyer, orderId, "Ten bags were wet");
    expect(await kindsOf(w.officer.userId)).toEqual(["ORDER_PROBLEM_REPORTED"]);
    expect(await alertsFor(w.admin.userId)).toMatchObject([
      { kind: "ORDER_PROBLEM_REPORTED", role: "ADMIN", cooperativeId: null, subjectId: orderId },
    ]);
    expect(await kindsOf(w.buyer.userId)).toEqual([]);
  });

  it("tells_officers_and_admins_a_problem_was_reported_after_completion", async () => {
    await markDelivered(w.officer, orderId, 10);
    await confirmReceipt(w.buyer, orderId);
    await clearAlerts();
    await reportProblem(w.buyer, orderId, "Ten bags were wet");
    expect(await kindsOf(w.officer.userId)).toEqual(["ORDER_PROBLEM_REPORTED"]);
    expect(await kindsOf(w.admin.userId)).toEqual(["ORDER_PROBLEM_REPORTED"]);
  });

  it("tells_buyer_and_officers_a_problem_was_resolved", async () => {
    await markDelivered(w.officer, orderId, 10);
    await reportProblem(w.buyer, orderId, "Ten bags were wet");
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { orderId } });
    await clearAlerts();
    await resolveDispute(w.admin, dispute.id, { outcome: "RELEASE", note: "Checked the photos" });
    expect(await alertKinds(w.buyer.userId)).toContain("DISPUTE_RESOLVED");
    expect(await alertKinds(w.officer.userId)).toContain("DISPUTE_RESOLVED");
    expect(await alertKinds(w.admin.userId)).toEqual([]);
  });

  it("tells_officers_the_buyer_cancelled_before_preparation", async () => {
    await cancelOrder(w.buyer, orderId, "Plans changed");
    expect(await alertKinds(w.officer.userId)).toEqual(["ORDER_CANCELLED_BY_BUYER"]);
  });

  it("tells_officers_the_buyer_asked_to_cancel_once", async () => {
    await startPreparing(w.officer, orderId);
    await clearAlerts();
    await cancelOrder(w.buyer, orderId, "Plans changed");
    await cancelOrder(w.buyer, orderId, "Plans changed again");
    expect(await alertKinds(w.officer.userId)).toEqual(["ORDER_CANCEL_REQUESTED"]);
  });

  it("a_refused_change_writes_no_alert", async () => {
    await startPreparing(w.officer, orderId);
    const before = await prisma.notification.count();
    await expect(startPreparing(w.officer, orderId)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(before);
  });
});
