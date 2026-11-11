import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakePaystack } from "@/lib/paystack";
import { fakeStorage } from "@/lib/storage";
import { countLabel } from "@/lib/summary";
import { adminHome, buyerHome, farmerHome, officerHome } from "@/modules/home/service";
import { farmerOffersSummary } from "@/modules/marketplace/service";
import { cleanDatabase, createTestCooperative } from "./helpers";
import { buyerMember, lotWorld, officerMember } from "./lot-fixtures";

// Wrap one summary so a test can make it fail; every other behaves as it does.
vi.mock("@/modules/marketplace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/marketplace/service")>();
  return { ...actual, farmerOffersSummary: vi.fn(actual.farmerOffersSummary) };
});

const forbidden = { name: "ForbiddenError" };

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  fakePaystack.clear();
});

afterAll(cleanDatabase);

const ids = (tiles: { id: string }[]) => tiles.map((t) => t.id);

describe("the home module", () => {
  it("farmer_home_has_its_tiles_in_order", async () => {
    const w = await lotWorld();
    const tiles = await farmerHome(w.farmer);
    expect(ids(tiles)).toEqual(["farmerOffers", "farmerCountered", "farmerLots", "farmerEarnings", "messages"]);
    expect(tiles.map((t) => t.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(tiles[2]).toMatchObject({ kind: "counts", counts: { pendingReview: 0, live: 0, soldOut: 0 }, seeAll: "/farmer/lots" });
    expect(tiles[3]).toMatchObject({ kind: "history", seeAll: "/farmer/earnings" });
  });

  it("officer_home_has_its_tiles_in_order_and_the_schedule", async () => {
    const w = await lotWorld();
    const home = await officerHome(w.officer);
    if (!home.verified) throw new Error("expected a verified cooperative");
    expect(ids(home.tiles)).toEqual([
      "officerFarmers",
      "officerLots",
      "officerOffers",
      "officerPrepare",
      "officerAttention",
      "officerRequests",
      "messages",
    ]);
    expect(home.schedule).toEqual({ overdue: [], days: [], more: 0, noDate: 0, later: 0 });
  });

  it("buyer_home_has_its_tiles_in_order", async () => {
    await lotWorld();
    const tiles = await buyerHome(await buyerMember("u-buyer"));
    expect(ids(tiles)).toEqual(["buyerOffers", "buyerConfirm", "buyerOrders", "buyerReceipts", "messages"]);
    expect(tiles.every((t) => t.status === "ok")).toBe(true);
  });

  it("admin_home_has_its_tiles_in_order", async () => {
    const w = await lotWorld();
    const tiles = await adminHome(w.admin);
    expect(ids(tiles)).toEqual([
      "adminCooperatives",
      "adminDisputes",
      "adminPayouts",
      "adminReconciliation",
      "adminNames",
      "adminLots",
      "messages",
    ]);
    expect(tiles.every((t) => t.status === "ok")).toBe(true);
  });

  it("a_failing_summary_becomes_an_error_tile_and_the_rest_load", async () => {
    const w = await lotWorld();
    vi.mocked(farmerOffersSummary).mockRejectedValueOnce(new Error("database is down: secret detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const tiles = await farmerHome(w.farmer);
    expect(tiles[0]).toEqual({ id: "farmerOffers", seeAll: "/farmer/lots", status: "error" });
    expect(tiles.slice(1).every((t) => t.status === "ok")).toBe(true);
    // Logged by tile id only: no error text, no data.
    expect(log).toHaveBeenCalledWith("home tile failed", { id: "farmerOffers" });
    log.mockRestore();
  });

  it("refuses_another_roles_home", async () => {
    const w = await lotWorld();
    const buyer = await buyerMember("u-buyer");
    await expect(farmerHome(w.officer)).rejects.toMatchObject(forbidden);
    await expect(farmerHome(buyer)).rejects.toMatchObject(forbidden);
    await expect(officerHome(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(officerHome(w.admin)).rejects.toMatchObject(forbidden);
    await expect(buyerHome(w.farmer)).rejects.toMatchObject(forbidden);
    await expect(buyerHome(w.admin)).rejects.toMatchObject(forbidden);
    await expect(adminHome(w.officer)).rejects.toMatchObject(forbidden);
    await expect(adminHome(buyer)).rejects.toMatchObject(forbidden);
    for (const home of [farmerHome, officerHome, buyerHome, adminHome]) {
      await expect(home(w.board)).rejects.toMatchObject(forbidden);
    }
  });

  it("unverified_officer_gets_no_tiles", async () => {
    const pending = await createTestCooperative({ name: "Pending Coop", status: "PENDING" });
    const officer = await officerMember("u-new-officer", pending.id);
    expect(await officerHome(officer)).toEqual({ verified: false });
  });

  it("a_count_over_ninety_nine_reaches_the_tile", async () => {
    const w = await lotWorld();
    const users = Array.from({ length: 101 }, (_, i) => `u-pending-${i}`);
    await prisma.user.createMany({
      data: users.map((id) => ({ id, name: `Pending ${id}`, email: `${id}@example.com`, phone: "+2348012345678", consentAcceptedAt: new Date() })),
    });
    await prisma.membership.createMany({
      data: users.map((userId) => ({ userId, role: "FARMER" as const, cooperativeId: w.cooperativeId, status: "PENDING" as const })),
    });
    await prisma.farmerProfile.createMany({
      data: users.map((userId) => ({ userId, cooperativeId: w.cooperativeId, farmSizeHectares: "1", state: "Kaduna", lga: "Zaria" })),
    });
    const home = await officerHome(w.officer);
    if (!home.verified) throw new Error("expected a verified cooperative");
    const tile = home.tiles[0];
    if (tile.status !== "ok" || tile.kind !== "todo") throw new Error("expected a to-do tile");
    expect(tile.summary.count).toBe(101);
    expect(tile.summary.items).toHaveLength(3);
    expect(countLabel(tile.summary.count)).toBe("99+");
  });
});

