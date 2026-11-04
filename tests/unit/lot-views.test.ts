import { describe, expect, it } from "vitest";
import { toFarmerLot, toOfficerLot, toPublicLot, type LotRow } from "@/modules/catalog/views";

const FLOOR = 4_321_987;
const FARMER_ID = "u-farmer-secret-id";

const row: LotRow = {
  id: "lot-1",
  cooperativeId: "coop-1",
  farmerUserId: FARMER_ID,
  cropId: "c-1",
  unitId: "un-1",
  quantity: 30,
  grade: "A",
  pickupState: "Kaduna",
  pickupLga: "Zaria",
  pickupNote: "Behind the market",
  askKobo: 6_500_000,
  floorKobo: FLOOR,
  note: null,
  deviation: "OK",
  quotedCutBps: 500,
  quotedFeeBps: 300,
  status: "LIVE",
  availableUntil: new Date("2026-11-20T00:00:00Z"),
  minOrderQty: 5,
  counterAskKobo: null,
  counterMessage: null,
  rejectionReason: null,
  screenedByUserId: "u-officer",
  approvedAt: new Date("2026-11-03T10:00:00Z"),
  createdAt: new Date("2026-11-03T09:00:00Z"),
  updatedAt: new Date("2026-11-03T10:00:00Z"),
  crop: { id: "c-1", name: "Maize" },
  unit: { id: "un-1", name: "Bag" },
  feeTerms: {
    id: "ft-1",
    lotId: "lot-1",
    cooperativeCutBps: 500,
    platformFeeBps: 300,
    lockedAt: new Date("2026-11-03T10:00:00Z"),
  },
  cooperative: { name: "Zaria Growers" },
  farmer: { name: "Ada Okafor" },
  revisions: [],
};

describe("lot views", () => {
  it("public_lot_type_has_no_floor", () => {
    const lot = toPublicLot(row, ["/photo-1"]);
    const json = JSON.stringify(lot);
    expect(json).not.toContain(String(FLOOR));
    expect(json).not.toMatch(/floor/i);
    expect(json).not.toContain(FARMER_ID);
    expect(json).not.toContain("Ada Okafor");
    expect(lot).toEqual({
      id: "lot-1",
      cooperativeId: "coop-1",
      cooperativeName: "Zaria Growers",
      crop: "Maize",
      unit: "Bag",
      quantity: 30,
      grade: "A",
      pickupState: "Kaduna",
      pickupLga: "Zaria",
      askKobo: 6_500_000,
      minOrderQty: 5,
      availableUntil: "2026-11-20",
      photoUrls: ["/photo-1"],
    });
    // @ts-expect-error PublicLot has no floor field.
    void lot.floorKobo;
  });

  it("gives the farmer their own floor and the locked terms", () => {
    const lot = toFarmerLot(row, []);
    expect(lot.floorKobo).toBe(FLOOR);
    expect(lot.quoted).toEqual({ cooperativeCutBps: 500, platformFeeBps: 300 });
    expect(lot.lockedTerms).toEqual({ cooperativeCutBps: 500, platformFeeBps: 300 });
    expect(lot.availableUntil).toBe("2026-11-20");
  });

  it("gives the officer the farmer's name but no contact details", () => {
    const lot = toOfficerLot(row, []);
    expect(lot.farmerName).toBe("Ada Okafor");
    expect(JSON.stringify(lot)).not.toMatch(/phone|email|recipient/i);
  });
});
