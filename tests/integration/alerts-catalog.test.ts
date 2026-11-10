import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeStorage } from "@/lib/storage";
import {
  approveCatalogRequest,
  approveLot,
  counterLot,
  declineCatalogRequest,
  declineCatalogRequestAsOfficer,
  decideRevision,
  forwardCatalogRequest,
  matchCatalogRequest,
  rejectLot,
  requestCatalogItem,
  requestRevision,
  respondToCounter,
  submitLot,
  withdrawLot,
} from "@/modules/catalog/service";
import { alertKinds, alertsFor } from "./alert-helpers";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { farmerMember, lotWorld, NOW, officerMember, PHOTO, type LotWorld } from "./lot-fixtures";

const guard = vi.hoisted(() => ({ open: false }));
vi.mock("@/modules/catalog/orders-guard", () => ({ hasOpenOrders: async () => guard.open }));

let w: LotWorld;

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  guard.open = false;
  w = await lotWorld();
  // lotWorld gives the board admin no membership row, and alerts go to membership holders.
  await prisma.membership.create({ data: { userId: w.board.userId, role: "BOARD_ADMIN", status: "ACTIVE" } });
});

afterAll(cleanDatabase);

const submit = () =>
  submitLot(w.farmer, w.input({ askKobo: 6_500_000, floorKobo: 5_500_000 }), [PHOTO], NOW);
async function liveLot() {
  const lot = await submit();
  await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
  return lot;
}
// Clears alerts raised while setting a test up, so each test sees only what its call wrote.
const clearAlerts = () => prisma.notification.deleteMany();
const change = { askKobo: 5_500_000, quantity: 40, floorKobo: 5_000_000 };

describe("lot alerts", () => {
  it("tells_officers_a_lot_was_submitted", async () => {
    const lot = await submit();
    expect(await alertKinds(w.officer.userId)).toEqual(["LOT_SUBMITTED"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
    const [row] = await alertsFor(w.officer.userId);
    expect(row).toMatchObject({
      role: "OFFICER",
      cooperativeId: w.cooperativeId,
      subjectType: "LOT",
      subjectId: lot.id,
      data: { crop: "Maize" },
    });
  });

  it("tells_officers_a_farmer_asked_to_change_a_lot", async () => {
    const lot = await liveLot();
    await clearAlerts();
    await requestRevision(w.farmer, lot.id, change, NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["LOT_REVISION_REQUESTED"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it.each([
    ["approved", true],
    ["refused", false],
  ])("tells_farmers_their_change_was_%s", async (_name, approve) => {
    const lot = await liveLot();
    const pending = await requestRevision(w.farmer, lot.id, change, NOW);
    await clearAlerts();
    await decideRevision(w.officer, pending.pendingRevision!.id, { approve, reason: "Not now" }, NOW);
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_REVISION_DECIDED"]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
    const [row] = await alertsFor(w.farmer.userId);
    expect(row).toMatchObject({ role: "FARMER", cooperativeId: w.cooperativeId, subjectId: lot.id });
  });

  it("tells_officers_a_lot_was_withdrawn", async () => {
    const lot = await liveLot();
    await clearAlerts();
    await withdrawLot(w.farmer, lot.id, NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["LOT_WITHDRAWN"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it("tells_farmers_their_lot_was_approved", async () => {
    const lot = await submit();
    await clearAlerts();
    await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_APPROVED"]);
    expect(await alertKinds(w.officer.userId)).toEqual([]);
  });

  it("tells_every_farmer_on_a_lot_it_was_approved", async () => {
    const lot = await submit();
    const other = await farmerMember("u-farmer-2", w.cooperativeId);
    await prisma.lotContribution.create({ data: { lotId: lot.id, farmerUserId: other.userId, quantity: 5 } });
    await clearAlerts();
    await approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW);
    expect(await alertKinds(other.userId)).toEqual(["LOT_APPROVED"]);
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_APPROVED"]);
  });

  it("tells_farmers_their_lot_was_rejected", async () => {
    const lot = await submit();
    await clearAlerts();
    await rejectLot(w.officer, lot.id, { reason: "Photos are unclear" });
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_REJECTED"]);
    // The reason is free text: it never goes into an alert.
    expect((await alertsFor(w.farmer.userId))[0].data).toEqual({ crop: "Maize" });
  });

  it("tells_farmers_their_lot_was_countered", async () => {
    const lot = await submit();
    await clearAlerts();
    await counterLot(w.officer, lot.id, { counterAskKobo: 6_000_000, message: "Try this" });
    expect(await alertKinds(w.farmer.userId)).toEqual(["LOT_COUNTERED"]);
    expect(JSON.stringify(await alertsFor(w.farmer.userId))).not.toContain("5500000");
  });

  it.each([
    ["accepted", true],
    ["declined", false],
  ])("tells_officers_a_counter_was_%s", async (_name, accept) => {
    const lot = await submit();
    await counterLot(w.officer, lot.id, { counterAskKobo: 6_000_000 });
    await clearAlerts();
    await respondToCounter(w.farmer, lot.id, accept, NOW);
    expect(await alertKinds(w.officer.userId)).toEqual(["LOT_COUNTER_ANSWERED"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
  });

  it("a_refused_change_writes_no_alert", async () => {
    const lot = await liveLot();
    const before = await prisma.notification.count();
    await expect(approveLot(w.officer, lot.id, { minOrderQty: 5 }, NOW)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(before);
  });
});

describe("catalog request alerts", () => {
  const requests = () => prisma.catalogRequest.findMany({ orderBy: { createdAt: "asc" } });

  it("tells_officers_a_crop_or_unit_was_requested", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    expect(await alertKinds(w.officer.userId)).toEqual(["CATALOG_REQUEST_MADE"]);
    expect(await alertKinds(w.farmer.userId)).toEqual([]);
    const [request] = await requests();
    expect(await alertsFor(w.officer.userId)).toMatchObject([
      { subjectType: "CATALOG_REQUEST", subjectId: request.id, data: { itemKind: "CROP", name: "Sorghum" } },
    ]);
  });

  it("does_not_alert_again_for_a_request_already_open", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    expect(await alertKinds(w.officer.userId)).toEqual(["CATALOG_REQUEST_MADE"]);
  });

  it("tells_board_admins_a_request_was_forwarded", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    const [request] = await requests();
    await forwardCatalogRequest(w.officer, request.id);
    expect(await alertKinds(w.board.userId)).toEqual(["CATALOG_REQUEST_FORWARDED"]);
    expect(await alertsFor(w.board.userId)).toMatchObject([{ role: "BOARD_ADMIN", cooperativeId: null }]);
  });

  it("tells_the_farmer_an_officer_declined_their_request", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    const [request] = await requests();
    await declineCatalogRequestAsOfficer(w.officer, request.id, { reason: "Not a crop here" });
    expect(await alertKinds(w.farmer.userId)).toEqual(["CATALOG_REQUEST_DECLINED"]);
    expect(await alertsFor(w.farmer.userId)).toMatchObject([{ role: null, cooperativeId: null }]);
  });

  it("tells_the_farmer_an_officer_matched_their_request_to_a_listed_item", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    const [request] = await requests();
    await matchCatalogRequest(w.officer, request.id, w.cropId);
    expect(await alertKinds(w.farmer.userId)).toEqual(["CATALOG_REQUEST_APPROVED"]);
  });

  it("tells_the_farmer_the_board_declined_their_request", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    const [request] = await requests();
    await forwardCatalogRequest(w.officer, request.id);
    await declineCatalogRequest(w.board, request.id, { reason: "Not now" });
    expect(await alertKinds(w.farmer.userId)).toEqual(["CATALOG_REQUEST_DECLINED"]);
    expect(await alertKinds(w.board.userId)).toEqual(["CATALOG_REQUEST_FORWARDED"]);
  });

  it("tells_every_requester_when_an_item_is_approved", async () => {
    const coopB = (await createTestCooperative({ name: "Coop B", status: "VERIFIED" })).id;
    const farmerB = await farmerMember("u-farmer-b", coopB);
    const officerB = await officerMember("u-officer-b", coopB);
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    await requestCatalogItem(farmerB, { kind: "CROP", name: "Sorghum" });
    for (const request of await requests()) {
      await forwardCatalogRequest(request.cooperativeId === coopB ? officerB : w.officer, request.id);
    }
    await clearAlerts();
    const [first, second] = await requests();
    await approveCatalogRequest(w.board, first.id, {});
    const mine = await alertsFor(w.farmer.userId);
    const theirs = await alertsFor(farmerB.userId);
    expect(mine.map((r) => r.kind)).toEqual(["CATALOG_REQUEST_APPROVED"]);
    expect(theirs.map((r) => r.kind)).toEqual(["CATALOG_REQUEST_APPROVED"]);
    expect(new Set([mine[0].subjectId, theirs[0].subjectId])).toEqual(new Set([first.id, second.id]));
    expect(mine[0].data).toEqual({ itemKind: "CROP", name: "Sorghum" });
  });

  it("a_refused_request_change_writes_no_alert", async () => {
    await requestCatalogItem(w.farmer, { kind: "CROP", name: "Sorghum" });
    const [request] = await requests();
    await declineCatalogRequestAsOfficer(w.officer, request.id, { reason: "Not a crop here" });
    const before = await prisma.notification.count();
    await expect(forwardCatalogRequest(w.officer, request.id)).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(before);
  });
});
