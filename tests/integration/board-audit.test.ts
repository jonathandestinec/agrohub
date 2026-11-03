import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";
import { recordPrice } from "@/modules/board/service";
import { createCrop, createUnit } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestUser } from "./helpers";

vi.mock("@/modules/audit/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/audit/audit")>();
  return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
});

const NOW = new Date("2026-11-08T22:30:00Z");

let board: Actor;
let entry: Parameters<typeof recordPrice>[1];

beforeEach(async () => {
  await cleanDatabase();
  vi.mocked(recordAudit).mockClear();
  const user = await createTestUser({ id: "u-board" });
  board = { userId: user.id, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  const cropId = (await createCrop(board, { name: "Maize" })).id;
  const unitId = (await createUnit(board, { name: "Bag" })).id;
  entry = { cropId, unitId, market: "Bodija Market", weekOf: "2026-11-02", priceKobo: 50000 };
});

afterAll(async () => {
  await cleanDatabase();
});

describe("price changes and their audit rows commit together", () => {
  it("price_change_rolls_back_when_audit_fails", async () => {
    await recordPrice(board, entry, NOW);
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error("connection blip"));
    await expect(recordPrice(board, { ...entry, priceKobo: 52000 }, NOW)).rejects.toThrow("connection blip");
    const [row] = await prisma.pricePoint.findMany();
    expect(row.priceKobo).toBe(50000);

    // The resubmit then records the change and its audit row.
    await recordPrice(board, { ...entry, priceKobo: 52000 }, NOW);
    const updates = await prisma.auditLog.findMany({ where: { action: "price.update", entityId: row.id } });
    expect(updates).toHaveLength(1);
    expect(updates[0].meta).toMatchObject({ fromKobo: 50000, toKobo: 52000 });
  });

  it("new_price_is_not_created_when_audit_fails", async () => {
    vi.mocked(recordAudit).mockRejectedValueOnce(new Error("connection blip"));
    await expect(recordPrice(board, entry, NOW)).rejects.toThrow("connection blip");
    expect(await prisma.pricePoint.count()).toBe(0);
  });
});
