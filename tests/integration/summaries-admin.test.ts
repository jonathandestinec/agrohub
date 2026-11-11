import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { approveLot, listScreeningQueue, screeningSummary, submitLot } from "@/modules/catalog/service";
import { listVerificationQueue, verificationSummary } from "@/modules/cooperatives/service";
import { listNameChangeQueue, nameChangeQueueSummary } from "@/modules/name-changes/service";
import { listOrderQueue, openDisputesSummary } from "@/modules/orders/service";
import {
  listPayoutIssues,
  listReconciliationIssues,
  payoutIssuesSummary,
  reconciliationSummary,
} from "@/modules/payments/service";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";
import { buyerMember, farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";
import { seedOrder } from "./order-fixtures";

const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const forbidden = { name: "ForbiddenError" };

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

async function paidOrderRow(w: LotWorld) {
  const lot = await submitLot(w.farmer, w.input({ quantity: 100 }), [PHOTO], NOW);
  await approveLot(w.officer, lot.id, { minOrderQty: 1 }, NOW);
  const buyer = await buyerMember("u-buyer");
  return seedOrder({ lotId: lot.id, buyerUserId: buyer.userId, quantity: 4, status: "PAID_HELD", paidAt: NOW });
}

describe("verificationSummary", () => {
  it("counts_submitted_pending_cooperatives_oldest_first_and_matches_the_queue", async () => {
    const w = await lotWorld();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push((await createTestCooperative({ name: `Pending ${i}`, status: "PENDING", submittedAt: at(i * HOUR) })).id);
    }
    await createTestCooperative({ name: "Not submitted", status: "PENDING", submittedAt: null });
    const summary = await verificationSummary(w.admin);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "Pending 0", href: `/admin/cooperatives/${ids[0]}` });
    expect(summary.count).toBe((await listVerificationQueue(w.admin)).length);
  });

  it("refuses_every_other_role", async () => {
    const w = await lotWorld();
    for (const who of [w.officer, w.farmer, w.board, await buyerMember("u-buyer")]) {
      await expect(verificationSummary(who)).rejects.toMatchObject(forbidden);
    }
  });
});

describe("openDisputesSummary", () => {
  it("counts_open_disputes_oldest_first_with_a_kind_label", async () => {
    const w = await lotWorld();
    const orderId = await paidOrderRow(w);
    const made: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      made.push(
        (await prisma.dispute.create({ data: { orderId, kind: i === 0 ? "TIMEOUT" : "REPORT", reason: "Secret reason text", createdAt: at(i * HOUR) } })).id,
      );
    }
    await prisma.dispute.create({ data: { orderId, kind: "REPORT", reason: "done", status: "RESOLVED", createdAt: NOW } });
    const summary = await openDisputesSummary(w.admin);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(made.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "4 Bag · Maize", href: `/admin/orders/${orderId}`, label: "admin.orders.kind.TIMEOUT" });
    expect(JSON.stringify(summary)).not.toContain("Secret reason");
    const queue = (await listOrderQueue(w.admin)).filter((q) => q.kind !== "PAYOUT" && q.kind !== "RECONCILIATION");
    expect(summary.count).toBe(queue.length);
  });

  it("refuses_every_other_role", async () => {
    const w = await lotWorld();
    for (const who of [w.officer, w.farmer, w.board]) await expect(openDisputesSummary(who)).rejects.toMatchObject(forbidden);
  });
});

describe("payoutIssuesSummary", () => {
  async function payout(orderId: string, patch: Record<string, unknown>, part: number, createdAt: Date) {
    return prisma.payout.create({
      data: {
        orderId,
        recipientType: "COOPERATIVE",
        recipientId: "coop",
        part,
        amountKobo: BigInt(123_456_700),
        reference: `PO-${orderId}-${part}`,
        sendableAt: NOW,
        createdAt,
        ...patch,
      },
    });
  }

  it("counts_failed_blocked_balance_refused_and_stale_payouts_with_a_label_and_no_amount", async () => {
    const w = await lotWorld();
    const orderId = await paidOrderRow(w);
    const failed = await payout(orderId, { status: "FAILED" }, 1, at(0));
    await payout(orderId, { status: "BLOCKED" }, 2, at(HOUR));
    await payout(orderId, { status: "QUEUED", balanceRefusals: 2 }, 3, at(2 * HOUR));
    const stale = await payout(orderId, { status: "SENT" }, 4, at(3 * HOUR));
    await prisma.payoutAttempt.create({
      data: { payoutId: stale.id, attempt: 1, transferReference: `${stale.reference}-1`, status: "SENT", createdAt: at(-100 * HOUR) },
    });
    await payout(orderId, { status: "QUEUED" }, 5, at(4 * HOUR)); // ordinary, not an issue
    await payout(orderId, { status: "PAID" }, 6, at(4 * HOUR));

    const summary = await payoutIssuesSummary(w.admin, NOW);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.label)).toEqual([
      "home.labels.payout.failed",
      "home.labels.payout.blocked",
      "home.labels.payout.waiting",
    ]);
    expect(summary.items[0]).toMatchObject({ id: failed.id, title: "Maize", href: "/admin/payouts" });
    expect(JSON.stringify(summary)).not.toMatch(/1234567|12,345|₦|Kobo/);
    expect(summary.count).toBe((await listPayoutIssues(w.admin, NOW)).length);
  });

  it("refuses_every_other_role", async () => {
    const w = await lotWorld();
    for (const who of [w.officer, w.farmer, w.board]) await expect(payoutIssuesSummary(who)).rejects.toMatchObject(forbidden);
  });
});

describe("reconciliationSummary", () => {
  it("counts_unresolved_issues_oldest_first_and_matches_the_list", async () => {
    const w = await lotWorld();
    const kinds = ["UNCONFIRMED_PAYMENT", "AMOUNT_MISMATCH", "STALE_REFUND", "LEDGER_UNBALANCED"];
    for (const [i, kind] of kinds.entries()) {
      await prisma.reconciliationIssue.create({ data: { kind, reference: `ref-${i}`, detail: { secret: 1 }, createdAt: at(i * HOUR) } });
    }
    await prisma.reconciliationIssue.create({ data: { kind: "STALE_TRANSFER", reference: "ref-done", detail: {}, resolvedAt: NOW } });
    const summary = await reconciliationSummary(w.admin);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.title)).toEqual(["ref-0", "ref-1", "ref-2"]);
    expect(summary.items[0]).toMatchObject({ label: "home.labels.reconciliation.UNCONFIRMED_PAYMENT", href: "/admin/orders" });
    expect(summary.count).toBe((await listReconciliationIssues(w.admin)).length);
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("refuses_every_other_role", async () => {
    const w = await lotWorld();
    for (const who of [w.officer, w.farmer, w.board]) await expect(reconciliationSummary(who)).rejects.toMatchObject(forbidden);
  });
});

describe("nameChangeQueueSummary", () => {
  it("counts_pending_requests_oldest_first_and_matches_the_queue", async () => {
    const w = await lotWorld();
    const requester = await createTestUser({ id: "u-requester" });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(
        (
          await prisma.nameChangeRequest.create({
            data: {
              subjectType: "USER",
              subjectId: (await createTestUser({ id: `u-requester-${i}` })).id,
              fromName: "Old Name",
              toName: `New Name ${i}`,
              reason: "A private reason",
              documentKind: "AFFIDAVIT",
              storageKey: "k",
              contentType: "image/jpeg",
              sizeBytes: 10,
              requestedByUserId: requester.id,
              createdAt: at(i * HOUR),
            },
          })
        ).id,
      );
    }
    await prisma.nameChangeRequest.create({
      data: {
        subjectType: "USER",
        subjectId: requester.id,
        fromName: "a",
        toName: "b",
        reason: "r",
        documentKind: "AFFIDAVIT",
        storageKey: "k",
        contentType: "image/jpeg",
        sizeBytes: 10,
        requestedByUserId: requester.id,
        status: "REJECTED",
      },
    });
    const summary = await nameChangeQueueSummary(w.admin);
    expect(summary.count).toBe(4);
    expect(summary.items.map((i) => i.id)).toEqual(ids.slice(0, 3));
    expect(summary.items[0]).toMatchObject({ title: "New Name 0", href: `/admin/names/${ids[0]}` });
    expect(JSON.stringify(summary)).not.toContain("private reason");
    expect(summary.count).toBe((await listNameChangeQueue(w.admin)).length);
  });

  it("refuses_every_other_role", async () => {
    const w = await lotWorld();
    for (const who of [w.officer, w.farmer, w.board]) await expect(nameChangeQueueSummary(who)).rejects.toMatchObject(forbidden);
  });
});

describe("the admin's lots to review", () => {
  it("reuses_the_screening_summary_and_leaves_out_lots_another_officer_can_screen", async () => {
    const w = await lotWorld();
    const solo = await createTestCooperative({ name: "Solo Coop", status: "VERIFIED" });
    const soloFarmer = await farmerMember("u-solo", solo.id);
    const soloOfficer = await officerMember("u-solo-officer", solo.id);
    await submitLot(soloFarmer, w.input(), [PHOTO], NOW);
    await prisma.membership.update({
      where: { userId_role_cooperativeId: { userId: soloOfficer.userId, role: "OFFICER", cooperativeId: solo.id } },
      data: { status: "REMOVED" },
    });
    await submitLot(w.farmer, w.input(), [PHOTO], NOW); // w.officer can screen this one
    const summary = await screeningSummary(w.admin);
    expect(summary.count).toBe(1);
    expect(summary.count).toBe((await listScreeningQueue(w.admin)).length);
  });
});
