import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { ForbiddenError } from "@/lib/errors";
import { confirmReceipt, markDelivered, setDeliveryDate, startCheckout, startPreparing } from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { officerMember } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await paidWorld();
});

afterAll(cleanDatabase);

const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

async function threadLines(orderId: string): Promise<string[]> {
  const o = await order(orderId);
  const thread = await prisma.thread.findFirstOrThrow({
    where: { lotId: o.lotId, kind: "BUYER_COOPERATIVE", counterpartUserId: o.buyerUserId },
    include: { messages: { where: { side: "ADMIN" }, orderBy: { createdAt: "asc" } } },
  });
  return thread.messages.map((m) => m.body);
}

describe("delivery", () => {
  it("prepares, proposes a date and marks 30 of 30 delivered, with AgroHub lines in the thread", async () => {
    const now = new Date();
    const { orderId } = await paidOrder(w, 30, now);
    await startPreparing(w.officer, orderId, now);
    expect((await order(orderId)).status).toBe("PREPARING");
    const date = addDays(lagosDateKey(now), 3);
    await setDeliveryDate(w.officer, orderId, date, now);
    expect((await order(orderId)).deliveryDate?.toISOString().slice(0, 10)).toBe(date);
    await markDelivered(w.officer, orderId, 30, now);
    const marked = await order(orderId);
    expect(marked).toMatchObject({ status: "DELIVERED_MARKED", deliveredQuantity: 30 });
    expect(marked.deliveredMarkedAt).toEqual(now);
    const lines = await threadLines(orderId);
    expect(lines.some((l) => l.startsWith("Delivery date proposed:"))).toBe(true);
    expect(lines).toContain("Marked delivered: 30 of 30 Bag");
    const actions = await prisma.auditLog.findMany({ where: { entityId: orderId }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["order.preparing", "order.delivery_date", "order.delivered"]));
  });

  it("marks delivered straight from PAID_HELD", async () => {
    const { orderId } = await paidOrder(w, 10);
    await markDelivered(w.officer, orderId, 8);
    expect(await order(orderId)).toMatchObject({ status: "DELIVERED_MARKED", deliveredQuantity: 8 });
  });

  it("refuses 31 of 30 and 0 with DELIVERED_RANGE", async () => {
    const { orderId } = await paidOrder(w, 30);
    await expect(markDelivered(w.officer, orderId, 31)).rejects.toMatchObject({ code: "DELIVERED_RANGE" });
    await expect(markDelivered(w.officer, orderId, 0)).rejects.toMatchObject({ code: "DELIVERED_RANGE" });
    expect((await order(orderId)).status).toBe("PAID_HELD");
  });

  it("refuses marking a PENDING_PAYMENT order with ORDER_STATE", async () => {
    const { orderId } = await startCheckout(w.buyer, { source: "LOT", lotId: w.lotId, quantity: 5 });
    await expect(markDelivered(w.officer, orderId, 5)).rejects.toMatchObject({ code: "ORDER_STATE" });
  });

  it("hides the order from another cooperative's officer", async () => {
    const { orderId } = await paidOrder(w, 10);
    const other = await createTestCooperative({ name: "Other", status: "VERIFIED" });
    const stranger = await officerMember("u-stranger", other.id);
    await expect(markDelivered(stranger, orderId, 10)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(startPreparing(stranger, orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("does not let the buyer mark delivered", async () => {
    const { orderId } = await paidOrder(w, 10);
    await expect(markDelivered(w.buyer, orderId, 10)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the buyer confirms once: COMPLETED, then ORDER_STATE", async () => {
    const { orderId } = await paidOrder(w, 30);
    await expect(confirmReceipt(w.buyer, orderId)).rejects.toMatchObject({ code: "ORDER_STATE" });
    await markDelivered(w.officer, orderId, 30);
    await confirmReceipt(w.buyer, orderId);
    expect((await order(orderId)).status).toBe("COMPLETED");
    await expect(confirmReceipt(w.buyer, orderId)).rejects.toMatchObject({ code: "ORDER_STATE" });
  });

  it("another buyer cannot confirm", async () => {
    const { orderId } = await paidOrder(w, 30);
    await markDelivered(w.officer, orderId, 30);
    const { buyerMember } = await import("./lot-fixtures");
    const other = await buyerMember("u-other-buyer");
    await expect(confirmReceipt(other, orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("refuses a past date or one more than 60 days on with DELIVERY_DATE_RANGE", async () => {
    const now = new Date();
    const { orderId } = await paidOrder(w, 10, now);
    const today = lagosDateKey(now);
    await expect(setDeliveryDate(w.officer, orderId, addDays(today, -1), now)).rejects.toMatchObject({ code: "DELIVERY_DATE_RANGE" });
    await expect(setDeliveryDate(w.officer, orderId, addDays(today, 61), now)).rejects.toMatchObject({ code: "DELIVERY_DATE_RANGE" });
    await expect(setDeliveryDate(w.officer, orderId, "2026-02-30", now)).rejects.toMatchObject({ code: "DELIVERY_DATE_RANGE" });
    await setDeliveryDate(w.officer, orderId, today, now);
    await setDeliveryDate(w.officer, orderId, addDays(today, 60), now);
  });
});
