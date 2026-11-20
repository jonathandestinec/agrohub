import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import { requestRevision, screeningVersion, submitLot } from "@/modules/catalog/service";
import { verificationQueueVersion } from "@/modules/cooperatives/service";
import { readTopics } from "@/modules/live/service";
import { nameQueueVersion } from "@/modules/name-changes/service";
import {
  adminOrdersQueueVersion,
  confirmReceipt,
  markDelivered,
  reportProblem,
  resolveDispute,
  startPreparing,
} from "@/modules/orders/service";
import { payoutIssuesVersion } from "@/modules/payments/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { NOW, officerMember, PHOTO } from "./lot-fixtures";
import { paidOrder, paidWorld, type PaidWorld } from "./paid-order";

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

let w: PaidWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  w = await paidWorld();
});

afterAll(cleanDatabase);

async function moves(read: () => Promise<string>, change: () => Promise<unknown>): Promise<boolean> {
  const before = await read();
  await pause();
  await change();
  return (await read()) !== before;
}

describe("screeningVersion", () => {
  it("moves_for_the_officer_and_an_admin_when_a_lot_is_submitted_and_not_for_another_cooperative", async () => {
    const other = await createTestCooperative({ name: "Other cooperative" });
    const otherOfficer = await officerMember("u-officer-other", other.id);
    const before = [await screeningVersion(w.officer), await screeningVersion(w.admin), await screeningVersion(otherOfficer)];
    await pause();
    await submitLot(w.farmer, w.input({ askKobo: 6_000_000, floorKobo: 5_000_000 }), [PHOTO], NOW);
    expect(await screeningVersion(w.officer)).not.toBe(before[0]);
    expect(await screeningVersion(w.admin)).not.toBe(before[1]);
    expect(await screeningVersion(otherOfficer)).toBe(before[2]);
  });

  it("moves_when_a_farmer_asks_to_change_a_live_lot_which_leaves_the_lot_row_alone", async () => {
    const lotBefore = await prisma.lot.findUniqueOrThrow({ where: { id: w.lotId } });
    const read = () => screeningVersion(w.officer);
    expect(
      await moves(read, () => requestRevision(w.farmer, w.lotId, { askKobo: 6_400_000, quantity: 25, floorKobo: 6_300_000 }, NOW)),
    ).toBe(true);
    const lotAfter = await prisma.lot.findUniqueOrThrow({ where: { id: w.lotId } });
    expect(lotAfter.updatedAt).toEqual(lotBefore.updatedAt);
    expect(
      await moves(
        () => screeningVersion(w.admin),
        () => prisma.lotRevision.updateMany({ where: { lotId: w.lotId, status: "PENDING" }, data: { status: "REJECTED" } }),
      ),
    ).toBe(true);
  });

  it("is_forbidden_for_a_farmer_and_a_buyer", async () => {
    await expect(screeningVersion(w.farmer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(screeningVersion(w.buyer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin order queue versions", () => {
  async function completedOrder() {
    const { orderId } = await paidOrder(w, 10);
    await startPreparing(w.officer, orderId);
    await markDelivered(w.officer, orderId, 10);
    await confirmReceipt(w.buyer, orderId);
    return orderId;
  }

  it("moves_on_a_new_dispute_and_when_it_is_decided", async () => {
    const { orderId } = await paidOrder(w, 10);
    const read = () => adminOrdersQueueVersion(w.admin);
    expect(await read()).toBe(await read());
    expect(await moves(read, () => reportProblem(w.buyer, orderId, "Half the bags were wet", new Date()))).toBe(true);
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { orderId } });
    expect(
      await moves(read, () => resolveDispute(w.admin, dispute.id, { outcome: "REFUND_ALL", note: "Refunded." }, new Date())),
    ).toBe(true);
  });

  it("moves_when_a_reconciliation_issue_is_raised_and_resolved", async () => {
    const read = () => adminOrdersQueueVersion(w.admin);
    let issueId = "";
    expect(
      await moves(read, async () => {
        issueId = (await prisma.reconciliationIssue.create({ data: { kind: "TEST", reference: "ref-1", detail: {} } })).id;
      }),
    ).toBe(true);
    expect(await moves(read, () => prisma.reconciliationIssue.update({ where: { id: issueId }, data: { resolvedAt: new Date() } }))).toBe(true);
  });

  it("payout_issues_move_when_a_payout_fails_and_when_it_is_retried", async () => {
    const orderId = await completedOrder();
    const read = () => payoutIssuesVersion(w.admin);
    expect(await prisma.payout.count({ where: { orderId } })).toBeGreaterThan(0);
    expect(await moves(read, () => prisma.payout.updateMany({ where: { orderId }, data: { status: "FAILED" } }))).toBe(true);
    expect(await moves(read, () => prisma.payout.updateMany({ where: { orderId }, data: { status: "QUEUED" } }))).toBe(true);
    // The orders queue carries the payout problems too.
    expect(
      await moves(
        () => adminOrdersQueueVersion(w.admin),
        () => prisma.payout.updateMany({ where: { orderId }, data: { status: "BLOCKED" } }),
      ),
    ).toBe(true);
  });

  it("is_forbidden_for_everyone_but_an_admin", async () => {
    for (const actor of [w.officer, w.farmer, w.buyer]) {
      await expect(adminOrdersQueueVersion(actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(payoutIssuesVersion(actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("verification and name queues", () => {
  it("the_verification_queue_moves_when_a_cooperative_is_submitted_and_decided", async () => {
    const read = () => verificationQueueVersion(w.admin);
    let id = "";
    expect(
      await moves(read, async () => {
        id = (await createTestCooperative({ name: "Waiting cooperative", status: "PENDING", submittedAt: new Date() })).id;
      }),
    ).toBe(true);
    expect(await moves(read, () => prisma.cooperative.update({ where: { id }, data: { status: "VERIFIED" } }))).toBe(true);
    await expect(verificationQueueVersion(w.officer)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the_name_queue_moves_when_a_request_arrives_and_is_decided", async () => {
    const read = () => nameQueueVersion(w.admin);
    let id = "";
    expect(
      await moves(read, async () => {
        id = (
          await prisma.nameChangeRequest.create({
            data: {
              subjectType: "USER",
              subjectId: w.farmer.userId,
              fromName: "Musa A",
              toName: "Musa B",
              reason: "Marriage",
              documentKind: "AFFIDAVIT",
              storageKey: "k",
              contentType: "application/pdf",
              sizeBytes: 1,
              requestedByUserId: w.farmer.userId,
            },
          })
        ).id;
      }),
    ).toBe(true);
    expect(
      await moves(read, () => prisma.nameChangeRequest.update({ where: { id }, data: { status: "APPROVED", decidedAt: new Date() } })),
    ).toBe(true);
    await expect(nameQueueVersion(w.buyer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("queue topics through readTopics", () => {
  it("answer_an_admin_with_versions_and_everyone_else_with_forbidden", async () => {
    const keys = ["queue:screening", "queue:admin-orders", "queue:payouts", "queue:verification", "queue:names"];
    const admin = await readTopics(w.admin, keys.map((key) => ({ key })));
    for (const key of keys) expect(admin[key]).toEqual({ version: expect.any(String) });
    const buyer = await readTopics(w.buyer, keys.map((key) => ({ key })));
    for (const key of keys) expect(buyer[key]).toEqual({ error: "forbidden" });
    const officer = await readTopics(w.officer, keys.map((key) => ({ key })));
    expect(officer["queue:screening"]).toEqual({ version: expect.any(String) });
    for (const key of keys.slice(1)) expect(officer[key]).toEqual({ error: "forbidden" });
  });
});
