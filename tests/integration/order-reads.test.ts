import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, submitLot } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { getCooperativeOrder, getOwnOrder, listCooperativeOrders, listOwnOrders } from "@/modules/orders/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

let w: LotWorld;
let buyer: Actor;
let lotId: string;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  w = await lotWorld();
  buyer = await buyerMember("u-buyer");
  const lot = await submitLot(w.farmer, w.input({ quantity: 30 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  lotId = lot.id;
});

afterAll(cleanDatabase);

describe("order reads", () => {
  it("lists the buyer's orders newest first and hides other buyers' orders", async () => {
    const older = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 5, status: "PAID_HELD" });
    const newer = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 6, status: "PAID_HELD" });
    expect((await listOwnOrders(buyer)).map((o) => o.id)).toEqual([newer, older]);
    const other = await buyerMember("u-other");
    expect(await listOwnOrders(other)).toEqual([]);
    await expect(getOwnOrder(other, older)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("shows the officer the buyer's name and each farmer's share from the locked terms", async () => {
    // 30 bags at ₦65,000, cut 4%, fee 3%: goods 195,000,000; cut 7,800,000; fee 5,850,000.
    const orderId = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 30, status: "PAID_HELD" });
    const view = await getCooperativeOrder(w.officer, orderId);
    expect(view).toMatchObject({
      buyerName: "Buyer u-buyer",
      orderStatus: "PAID_HELD",
      cutKobo: 7_800_000,
      feeKobo: 5_850_000,
      farmerShares: [{ farmerName: "Farmer u-farmer", quantity: 30, amountKobo: 181_350_000 }],
    });
    expect((await listCooperativeOrders(w.officer)).map((o) => o.id)).toEqual([orderId]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("+234");
    const elsewhere = (await createTestCooperative({ name: "Other Co", status: "VERIFIED" })).id;
    const stranger = await officerMember("u-stranger", elsewhere);
    await expect(getCooperativeOrder(stranger, orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("never gives the buyer farmer shares, the floor or the farmer's name", async () => {
    const orderId = await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 30, status: "PAID_HELD" });
    const json = JSON.stringify(await getOwnOrder(buyer, orderId));
    expect(json).not.toContain("farmerShares");
    expect(json).not.toContain("6000000");
    expect(json).not.toContain("u-farmer");
  });

  it("lists only paid orders for the officer, not abandoned checkouts", async () => {
    await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 5, status: "PENDING_PAYMENT" });
    await seedOrder({ lotId, buyerUserId: buyer.userId, quantity: 5, status: "CANCELLED" });
    expect(await listCooperativeOrders(w.officer)).toEqual([]);
  });
});
