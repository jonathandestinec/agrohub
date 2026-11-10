import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeOutbox } from "@/lib/email";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { completeOrder, markDelivered } from "@/modules/orders/service";
import { listPayoutIssues, retryPayout, sendDuePayouts, unblockPayout } from "@/modules/payments/service";
import { cleanDatabase } from "./helpers";
import { HOUR, paidOrder, paidWorld, type PaidWorld } from "./paid-order";

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
  fakeOutbox.clear();
  w = await paidWorld({ quantity: 60 });
});

afterAll(cleanDatabase);

async function releasedOrder() {
  const at = new Date();
  const { orderId, paidAt } = await paidOrder(w, 30, at);
  await markDelivered(w.officer, orderId, 30, at);
  await completeOrder(orderId, "BUYER", at);
  return { orderId, due: new Date(paidAt.getTime() + 24 * HOUR) };
}

const farmerPayout = (orderId: string) =>
  prisma.payout.findFirstOrThrow({
    where: { orderId, recipientType: "FARMER" },
    include: { attempts: { orderBy: { attempt: "asc" } } },
  });

async function failedFarmerPayout() {
  const { orderId, due } = await releasedOrder();
  fakePaystack.transferMode = "fail";
  await sendDuePayouts({ now: due });
  fakePaystack.transferMode = "success";
  const payout = await farmerPayout(orderId);
  expect(payout.status).toBe("FAILED");
  return { orderId, due, payout };
}

describe("retryPayout", () => {
  it("retries a failed payout with attempt 2 and pays it", async () => {
    const { orderId, due, payout } = await failedFarmerPayout();
    await retryPayout(w.admin, payout.id, { useCurrentAccount: false }, due);
    const after = await farmerPayout(orderId);
    expect(after.status).toBe("PAID");
    expect(after.attempts.map((a) => [a.attempt, a.transferReference, a.status])).toEqual([
      [1, `${payout.reference}-1`, "FAILED"],
      [2, `${payout.reference}-2`, "SUCCEEDED"],
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payout.retry", entityId: payout.id } });
    expect(audit.meta).toEqual({ payoutId: payout.id, useCurrentAccount: false });
  });

  it("refuses while Paystack still reports the last attempt pending: PAYOUT_STILL_PENDING", async () => {
    const { orderId, due, payout } = await failedFarmerPayout();
    // Our record says failed, but Paystack now reports the transfer as still in progress.
    fakePaystack.transfers.get(`${payout.reference}-1`)!.status = "pending";
    await expect(retryPayout(w.admin, payout.id, { useCurrentAccount: false }, due)).rejects.toMatchObject({ code: "PAYOUT_STILL_PENDING" });
    expect((await farmerPayout(orderId)).attempts).toHaveLength(1);
  });

  it("refuses a payout that has not failed: PAYOUT_NOT_FAILED", async () => {
    const { orderId, due } = await releasedOrder();
    await sendDuePayouts({ now: due });
    const paid = await farmerPayout(orderId);
    await expect(retryPayout(w.admin, paid.id, { useCurrentAccount: false }, due)).rejects.toMatchObject({ code: "PAYOUT_NOT_FAILED" });
  });

  it("retries to the current account once the farmer's bank change took effect", async () => {
    const { orderId, due, payout } = await failedFarmerPayout();
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: w.farmer.userId } });
    await prisma.bankChangeRequest.create({
      data: {
        ownerType: "FARMER",
        ownerId: profile.id,
        newRecipientCode: "RCP_NEW",
        newAccountName: "FARMER",
        newBankName: "Bank",
        requestedBy: w.farmer.userId,
        confirmToken: "tok-retry",
        confirmedAt: new Date(due.getTime() - 49 * HOUR),
        effectiveAt: new Date(due.getTime() - HOUR),
      },
    });
    await retryPayout(w.admin, payout.id, { useCurrentAccount: true }, due);
    const after = await farmerPayout(orderId);
    expect(after).toMatchObject({ status: "PAID", recipientCode: "RCP_NEW" });
    expect(fakePaystack.transfers.get(`${payout.reference}-2`)?.recipientCode).toBe("RCP_NEW");
  });

  it("an officer cannot retry or unblock", async () => {
    const { payout, due } = await failedFarmerPayout();
    await expect(retryPayout(w.officer, payout.id, { useCurrentAccount: false }, due)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(unblockPayout(w.officer, payout.id, due)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPayoutIssues(w.officer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("unblockPayout", () => {
  async function blocked() {
    await prisma.farmerProfile.update({ where: { userId: w.farmer.userId }, data: { recipientCode: null } });
    const { orderId, due } = await releasedOrder();
    const payout = await farmerPayout(orderId);
    expect(payout.status).toBe("BLOCKED");
    return { orderId, due, payout };
  }

  it("queues a blocked payout once the farmer has an account, then it is paid", async () => {
    const { orderId, due, payout } = await blocked();
    await prisma.farmerProfile.update({ where: { userId: w.farmer.userId }, data: { recipientCode: "RCP_ADDED" } });
    await unblockPayout(w.admin, payout.id, due);
    const after = await farmerPayout(orderId);
    expect(after).toMatchObject({ status: "PAID", recipientCode: "RCP_ADDED" });
    expect(await prisma.auditLog.count({ where: { action: "payout.unblock", entityId: payout.id } })).toBe(1);
  });

  it("still no account: NO_RECIPIENT", async () => {
    const { payout, due } = await blocked();
    await expect(unblockPayout(w.admin, payout.id, due)).rejects.toMatchObject({ code: "NO_RECIPIENT" });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("BLOCKED");
  });
});

describe("listPayoutIssues", () => {
  it("lists failed, blocked, balance-refused and long-pending payouts without account details", async () => {
    const { payout: failed, due } = await failedFarmerPayout();
    const json = JSON.stringify(await listPayoutIssues(w.admin, due));
    expect(json).not.toContain("RCP_");
    const issues = await listPayoutIssues(w.admin, due);
    expect(issues.map((i) => [i.status, i.attempts, i.recipientType]).sort()).toEqual([["FAILED", 1, "COOPERATIVE"], ["FAILED", 1, "FARMER"]]);
    expect(issues.find((i) => i.id === failed.id)).toMatchObject({ amountKobo: 179_400_000, recipientName: `Farmer ${w.farmer.userId}`, lastFailure: "FAILED" });

    // A transfer awaiting Paystack shows only after 3 days.
    const second = await releasedOrder();
    fakePaystack.transferMode = "pending";
    await sendDuePayouts({ now: second.due });
    expect((await listPayoutIssues(w.admin, new Date(second.due.getTime() + 71 * HOUR))).map((i) => i.status)).toEqual(["FAILED", "FAILED"]);
    const later = await listPayoutIssues(w.admin, new Date(second.due.getTime() + 73 * HOUR));
    expect(later.map((i) => i.status).sort()).toEqual(["FAILED", "FAILED", "SENT", "SENT"]);
    expect(later.find((i) => i.status === "SENT")?.sentAt).toBe(second.due.toISOString());
  });
});
