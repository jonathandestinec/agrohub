import type { Prisma, Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Either the shared client or a transaction client, so a caller can alert inside its transaction.
export type Db = Prisma.TransactionClient | typeof prisma;

// Who an alert is for. `role` null shows it under every role the person has; `cooperativeId`
// null means it is not tied to a cooperative.
export type Recipient = { userId: string; role: Role | null; cooperativeId: string | null };

export const buyer = (userId: string): Recipient => ({ userId, role: "BUYER", cooperativeId: null });
// For alerts about the person themself (a membership decision, a name change, a catalog request).
export const person = (userId: string): Recipient => ({ userId, role: null, cooperativeId: null });
export const farmer = (userId: string, cooperativeId: string): Recipient => ({
  userId,
  role: "FARMER",
  cooperativeId,
});

// Addresses of every user with an ACTIVE ADMIN membership, one per user.
export async function listActiveAdminEmails(): Promise<string[]> {
  const admins = await prisma.membership.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { user: { select: { email: true } } },
    distinct: ["userId"],
  });
  return admins.map((admin) => admin.user.email);
}

export async function officersOf(db: Db, cooperativeId: string): Promise<Recipient[]> {
  const rows = await db.membership.findMany({
    where: { role: "OFFICER", status: "ACTIVE", cooperativeId },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => ({ userId: row.userId, role: "OFFICER", cooperativeId }));
}

async function activeWithRole(db: Db, role: "ADMIN" | "BOARD_ADMIN"): Promise<Recipient[]> {
  const rows = await db.membership.findMany({
    where: { role, status: "ACTIVE" },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => ({ userId: row.userId, role, cooperativeId: null }));
}

export const activeAdmins = (db: Db): Promise<Recipient[]> => activeWithRole(db, "ADMIN");
export const activeBoardAdmins = (db: Db): Promise<Recipient[]> => activeWithRole(db, "BOARD_ADMIN");

// The farmer who submitted the lot and every farmer with a contribution to it.
export async function farmersOfLot(db: Db, lotId: string): Promise<Recipient[]> {
  const lot = await db.lot.findUnique({
    where: { id: lotId },
    select: { farmerUserId: true, cooperativeId: true, contributions: { select: { farmerUserId: true } } },
  });
  if (!lot) return [];
  const ids = new Set([lot.farmerUserId, ...lot.contributions.map((c) => c.farmerUserId)]);
  return [...ids].map((userId) => farmer(userId, lot.cooperativeId));
}

// The thread's buyer or farmer, plus the cooperative's officers.
export async function threadAudience(db: Db, threadId: string): Promise<Recipient[]> {
  const thread = await db.thread.findUnique({
    where: { id: threadId },
    select: { kind: true, cooperativeId: true, counterpartUserId: true },
  });
  if (!thread) return [];
  const counterpart =
    thread.kind === "BUYER_COOPERATIVE"
      ? buyer(thread.counterpartUserId)
      : farmer(thread.counterpartUserId, thread.cooperativeId);
  return [counterpart, ...(await officersOf(db, thread.cooperativeId))];
}
