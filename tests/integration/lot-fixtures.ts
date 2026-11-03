import { prisma } from "@/lib/db";
import { addDays, lagosDateKey } from "@/lib/lagos-date";
import { createCrop, createUnit } from "@/modules/catalog/service";
import type { Actor } from "@/modules/identity/policies";
import { createTestCooperative, createTestUser } from "./helpers";

export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const PHOTO = { body: JPEG, contentType: "image/jpeg" };
export const NOW = new Date("2026-11-03T12:00:00Z");

export type LotInput = {
  cropId: string;
  unitId: string;
  quantity: number;
  grade: "A" | "B" | "C" | "UNGRADED";
  pickupState: string;
  pickupLga: string;
  askKobo: number;
  floorKobo: number;
  availableUntil: string;
  note?: string;
  pickupNote?: string;
};

export type LotWorld = {
  cooperativeId: string;
  farmer: Actor;
  officer: Actor;
  board: Actor;
  admin: Actor;
  cropId: string;
  unitId: string;
  input: (overrides?: Record<string, unknown>) => LotInput;
};

// An ACTIVE farmer member; with a payout account unless withBank is false.
export async function farmerMember(userId: string, cooperativeId: string, withBank = true): Promise<Actor> {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) {
    await createTestUser({ id: userId, name: `Farmer ${userId}` });
  }
  await prisma.membership.create({ data: { userId, role: "FARMER", cooperativeId, status: "ACTIVE" } });
  await prisma.farmerProfile.create({
    data: {
      userId,
      cooperativeId,
      farmSizeHectares: "1",
      state: "Kaduna",
      lga: "Zaria",
      recipientCode: withBank ? `RCP_${userId}` : null,
      accountName: withBank ? "FARMER" : null,
    },
  });
  return { userId, role: "FARMER", cooperativeId, twoFactorEnabled: false };
}

export async function officerMember(userId: string, cooperativeId: string): Promise<Actor> {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) {
    await createTestUser({ id: userId, name: `Officer ${userId}` });
  }
  await prisma.membership.create({ data: { userId, role: "OFFICER", cooperativeId, status: "ACTIVE" } });
  return { userId, role: "OFFICER", cooperativeId, twoFactorEnabled: true };
}

// An ACTIVE buyer (verified email), named so tests can look for the name in views.
export async function buyerMember(userId: string): Promise<Actor> {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) {
    await createTestUser({ id: userId, name: `Buyer ${userId}` });
  }
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await prisma.membership.create({ data: { userId, role: "BUYER", status: "ACTIVE" } });
  return { userId, role: "BUYER", cooperativeId: null, twoFactorEnabled: false };
}

// A VERIFIED cooperative whose cut is 4%, with an ACTIVE farmer who has a payout account,
// one officer, a board admin, an admin, and the crop Maize sold by the Bag.
export async function lotWorld(): Promise<LotWorld> {
  const cooperativeId = (
    await createTestCooperative({ name: "Zaria Growers", status: "VERIFIED", cutBps: 400 })
  ).id;
  const farmer = await farmerMember("u-farmer", cooperativeId);
  const officer = await officerMember("u-officer", cooperativeId);
  await createTestUser({ id: "u-board" });
  const board: Actor = { userId: "u-board", role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true };
  await createTestUser({ id: "u-admin" });
  const admin: Actor = { userId: "u-admin", role: "ADMIN", cooperativeId: null, twoFactorEnabled: true };
  const cropId = (await createCrop(board, { name: "Maize" })).id;
  const unitId = (await createUnit(board, { name: "Bag" })).id;
  const until = addDays(lagosDateKey(NOW), 14);
  return {
    cooperativeId,
    farmer,
    officer,
    board,
    admin,
    cropId,
    unitId,
    input: (overrides = {}) => ({
      cropId,
      unitId,
      quantity: 30,
      grade: "A",
      pickupState: "Kaduna",
      pickupLga: "Zaria",
      askKobo: 6_500_000,
      floorKobo: 6_000_000,
      availableUntil: until,
      ...overrides,
    }),
  };
}
