import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, rejectLot, submitLot, counterLot } from "@/modules/catalog/service";
import { farmerRespondToOffer, makeOffer, respondToOffer } from "@/modules/marketplace/service";
import {
  confirmReceipt,
  markDelivered,
  setDeliveryDate,
  startPreparing,
} from "@/modules/orders/service";
import { cleanDatabase } from "./helpers";
import { NOW, PHOTO } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld();
  fakeOutbox.clear();
});

afterAll(cleanDatabase);

const mailTo = (userId: string) => fakeOutbox.sent.filter((m) => m.to === `${userId}@example.com`);
const subjectsTo = (userId: string) => mailTo(userId).map((m) => m.subject);

describe("delivery emails", () => {
  it("setting a delivery date, marking delivered and confirming receipt each email the right people once", async () => {
    const { orderId } = await paidOrder(w, 10);
    fakeOutbox.clear();

    await startPreparing(w.officer, orderId);
    // Preparing is chatty: in-app only.
    expect(fakeOutbox.sent).toHaveLength(0);

    await setDeliveryDate(w.officer, orderId, "2026-12-01");
    expect(subjectsTo(w.buyer.userId)).toEqual(["Delivery date set for your order"]);
    expect(mailTo(w.buyer.userId)[0].html).toContain("Dec 1, 2026");
    expect(mailTo(w.buyer.userId)[0].html).toContain(`/buyer/orders/${orderId}`);
    expect(subjectsTo(w.officer.userId)).toEqual([]);

    fakeOutbox.clear();
    await markDelivered(w.officer, orderId, 10);
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your order was delivered: please confirm"]);

    fakeOutbox.clear();
    await confirmReceipt(w.buyer, orderId);
    expect(subjectsTo(w.officer.userId)).toEqual(["The buyer confirmed receipt"]);
    expect(subjectsTo(w.buyer.userId)).toEqual([]);
  });

  it("a mail failure leaves the delivery saved", async () => {
    const { orderId } = await paidOrder(w, 10);
    await startPreparing(w.officer, orderId);
    const email = await import("@/lib/email");
    const spy = vi.spyOn(email, "sendEmail").mockRejectedValue(new Error("Resend failed to send email (rate_limit_exceeded)"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await markDelivered(w.officer, orderId, 10);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("DELIVERED_MARKED");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/@example\.com|<p>/);
    spy.mockRestore();
    log.mockRestore();
  });
});

describe("offer emails", () => {
  const offer = async (offeredKobo = 6_500_000) =>
    (await makeOffer(w.buyer, { lotId: w.lotId, quantity: 10, offeredKobo }, new Date())).id;

  it("an accepted offer emails the buyer and not the officer who accepted", async () => {
    const id = await offer();
    fakeOutbox.clear();
    await respondToOffer(w.officer, id, { decision: "ACCEPT" }, new Date());
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your offer was accepted"]);
    expect(mailTo(w.buyer.userId)[0].html).toContain(`/buyer/offers/${id}`);
    expect(subjectsTo(w.officer.userId)).toEqual([]);
  });

  it("a counter emails the buyer, with no price in the email", async () => {
    const id = await offer(6_000_000);
    fakeOutbox.clear();
    await respondToOffer(w.officer, id, { decision: "COUNTER", counterKobo: 6_499_950 }, new Date());
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your offer got a counter price"]);
    expect(mailTo(w.buyer.userId)[0].html).not.toMatch(/₦|6,499|65,000|floor/i);
  });

  it("a declined offer sends no email (in-app only)", async () => {
    const id = await offer(6_000_000);
    fakeOutbox.clear();
    await respondToOffer(w.officer, id, { decision: "REJECT" }, new Date());
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("a referral to the farmer emails nobody; the farmer agreeing then emails the buyer once", async () => {
    const id = await offer(6_000_000);
    fakeOutbox.clear();
    await respondToOffer(w.officer, id, { decision: "ACCEPT" }, new Date());
    expect(fakeOutbox.sent).toHaveLength(0);
    await farmerRespondToOffer(w.farmer, id, true, new Date());
    expect(subjectsTo(w.buyer.userId)).toEqual(["Your offer was accepted"]);
    expect(subjectsTo(w.officer.userId)).toEqual([]);
  });

  it("a failing answer sends no email", async () => {
    const id = await offer();
    await respondToOffer(w.officer, id, { decision: "REJECT" }, new Date());
    fakeOutbox.clear();
    await expect(respondToOffer(w.officer, id, { decision: "ACCEPT" }, new Date())).rejects.toMatchObject({ code: "OFFER_NOT_OPEN" });
    expect(fakeOutbox.sent).toHaveLength(0);
  });
});

describe("lot emails", () => {
  const submit = () =>
    submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: 5_500_000 }), [PHOTO], NOW);

  it("an approved lot emails its farmer, not the officer who approved it", async () => {
    const lot = await submit();
    fakeOutbox.clear();
    await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
    expect(subjectsTo(w.farmer.userId)).toEqual(["Your lot was approved"]);
    expect(mailTo(w.farmer.userId)[0].html).toContain(`/farmer/lots/${lot.id}`);
    expect(subjectsTo(w.officer.userId)).toEqual([]);
  });

  it("a rejected lot emails its farmer without the floor price", async () => {
    const lot = await submit();
    fakeOutbox.clear();
    await rejectLot(w.officer, lot.id, { reason: "The photos are unclear" });
    expect(subjectsTo(w.farmer.userId)).toEqual(["Your lot was not approved"]);
    expect(mailTo(w.farmer.userId)[0].html).not.toMatch(/5,500|55,000|floor|photos are unclear/i);
  });

  it("a counter on a lot stays in-app only", async () => {
    const lot = await submit();
    fakeOutbox.clear();
    await counterLot(w.officer, lot.id, { counterAskKobo: 6_000_000 });
    expect(fakeOutbox.sent).toHaveLength(0);
  });
});
