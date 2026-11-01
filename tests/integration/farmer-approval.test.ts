import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const hasUnfinishedOrders = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/modules/farmers/orders-guard", () => ({
  hasUnfinishedOrders: (...args: unknown[]) => hasUnfinishedOrders(...args),
}));
const sendEmail = vi.hoisted(() => ({ failNext: false }));
vi.mock("@/lib/email", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...original,
    sendEmail: (msg: Parameters<typeof original.sendEmail>[0]) => {
      if (sendEmail.failNext) {
        sendEmail.failNext = false;
        return Promise.reject(new Error("smtp down"));
      }
      return original.sendEmail(msg);
    },
  };
});

import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  approveFarmer,
  joinViaLink,
  leaveCooperative,
  listActiveFarmers,
  listPendingFarmers,
  rejectFarmer,
  removeFarmer,
} from "@/modules/farmers/service";
import type { Actor } from "@/modules/identity/policies";
import { getActor } from "@/modules/identity/session";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const T = new Date("2031-06-10T12:00:00Z");
const PROFILE = {
  farmSizeHectares: "2.5",
  crops: ["Maize"],
  state: "Ogun",
  lga: "Abeokuta North",
};

let coopA: string;
let coopB: string;
let officerA: Actor;
let officerB: Actor;

async function addOfficer(userId: string, cooperativeId: string): Promise<Actor> {
  await createTestUser({ id: userId });
  await prisma.membership.create({
    data: { userId, role: "OFFICER", cooperativeId, status: "ACTIVE", approvedAt: T },
  });
  return { userId, role: "OFFICER", cooperativeId, twoFactorEnabled: false };
}

function farmerActor(userId: string, cooperativeId: string): Actor {
  return { userId, role: "FARMER", cooperativeId, twoFactorEnabled: false };
}

async function inviteToken(cooperativeId: string): Promise<string> {
  const open = await prisma.inviteLink.findFirst({
    where: { cooperativeId, email: null, revokedAt: null },
  });
  if (open) return open.token;
  const token = `tok-${cooperativeId}`;
  await prisma.inviteLink.create({ data: { cooperativeId, token, createdBy: "x" } });
  return token;
}

// A farmer who joined cooperativeId and now sits in `status`.
async function farmerIn(
  userId: string,
  cooperativeId: string,
  status: "PENDING" | "ACTIVE" | "LEFT" | "REMOVED" = "PENDING",
): Promise<{ membershipId: string }> {
  await createTestUser({ id: userId });
  const { membershipId } = await joinViaLink(
    { userId },
    await inviteToken(cooperativeId),
    PROFILE,
    T,
  );
  if (status !== "PENDING") {
    await prisma.membership.update({
      where: { id: membershipId },
      data: { status, approvedAt: status === "ACTIVE" || status === "LEFT" ? T : null },
    });
  }
  return { membershipId };
}

async function statusOf(membershipId: string) {
  return prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
}

async function auditFor(action: string, entityId: string) {
  return prisma.auditLog.findMany({ where: { action, entityId } });
}

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
  sendEmail.failNext = false;
  getSession.mockReset();
  hasUnfinishedOrders.mockReset();
  hasUnfinishedOrders.mockResolvedValue(false);
  coopA = (await createTestCooperative({ name: "Coop A", status: "VERIFIED" })).id;
  coopB = (await createTestCooperative({ name: "Coop B", status: "VERIFIED" })).id;
  officerA = await addOfficer("u-off-a", coopA);
  officerB = await addOfficer("u-off-b", coopB);
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("approveFarmer", () => {
  it("moves PENDING to ACTIVE, sets approvedAt, audits and emails the farmer", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await approveFarmer(officerA, membershipId, T);

    const row = await statusOf(membershipId);
    expect(row.status).toBe("ACTIVE");
    expect(row.approvedAt?.toISOString()).toBe(T.toISOString());

    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].to).toBe("u-f1@example.com");
    expect(fakeOutbox.sent[0].html).toContain("Coop A");

    const audit = await auditFor("farmer.approve", membershipId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(officerA.userId);
    expect(audit[0].meta).toEqual({
      membershipId,
      cooperativeId: coopA,
      from: "PENDING",
      to: "ACTIVE",
    });
  });

  it("refuses an ACTIVE membership with ILLEGAL_TRANSITION and sends nothing", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    const error = await approveFarmer(officerA, membershipId, T).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "ILLEGAL_TRANSITION" });
    expect(fakeOutbox.sent).toHaveLength(0);
    expect(await auditFor("farmer.approve", membershipId)).toHaveLength(0);
  });

  it("refuses an officer of another cooperative with ForbiddenError", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await expect(approveFarmer(officerB, membershipId, T)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await statusOf(membershipId)).status).toBe("PENDING");
  });

  it("refuses a farmer and an unknown membership", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await expect(
      approveFarmer(farmerActor("u-f1", coopA), membershipId, T),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveFarmer(officerA, "nope", T)).rejects.toMatchObject({
      code: "MEMBERSHIP_NOT_FOUND",
    });
  });

  it("does not act on an officer membership through the farmer path", async () => {
    const officerMembership = await prisma.membership.findFirstOrThrow({
      where: { userId: officerA.userId },
    });
    await expect(approveFarmer(officerA, officerMembership.id, T)).rejects.toMatchObject({
      code: "MEMBERSHIP_NOT_FOUND",
    });
  });

  it("still approves when the email cannot be sent, logging no address", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    sendEmail.failNext = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await approveFarmer(officerA, membershipId, T);
    expect((await statusOf(membershipId)).status).toBe("ACTIVE");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("example.com");
    log.mockRestore();
  });
});

describe("rejectFarmer", () => {
  it("moves PENDING to REMOVED with a reason, audits and emails", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await rejectFarmer(officerA, membershipId, "  Not a member of our group  ");
    expect((await statusOf(membershipId)).status).toBe("REMOVED");
    const audit = await auditFor("farmer.reject", membershipId);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({
      membershipId,
      cooperativeId: coopA,
      from: "PENDING",
      to: "REMOVED",
      reason: "Not a member of our group",
    });
    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].html).toContain("Not a member of our group");
  });

  it("refuses an ACTIVE membership", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await expect(rejectFarmer(officerA, membershipId, "no")).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("refuses another cooperative's officer", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await expect(rejectFarmer(officerB, membershipId, "no")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["too long", "x".repeat(501)],
  ])("rejects a %s reason with ValidationError", async (_label, reason) => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await expect(rejectFarmer(officerA, membershipId, reason)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await statusOf(membershipId)).status).toBe("PENDING");
  });

  it("accepts a 500-character reason", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await rejectFarmer(officerA, membershipId, "x".repeat(500));
    expect((await statusOf(membershipId)).status).toBe("REMOVED");
  });
});

describe("removeFarmer", () => {
  it("moves ACTIVE to REMOVED, keeps the rows, audits and emails", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await removeFarmer(officerA, membershipId, "Left the group");
    expect((await statusOf(membershipId)).status).toBe("REMOVED");
    expect(await prisma.farmerProfile.count({ where: { userId: "u-f1" } })).toBe(1);
    expect(hasUnfinishedOrders).toHaveBeenCalledWith("u-f1");
    const audit = await auditFor("farmer.remove", membershipId);
    expect(audit[0].meta).toEqual({
      membershipId,
      cooperativeId: coopA,
      from: "ACTIVE",
      to: "REMOVED",
      reason: "Left the group",
    });
    expect(fakeOutbox.sent).toHaveLength(1);
  });

  it("is blocked by unfinished orders with UNFINISHED_ORDERS", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    hasUnfinishedOrders.mockResolvedValue(true);
    const error = await removeFarmer(officerA, membershipId, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "UNFINISHED_ORDERS" });
    expect((await statusOf(membershipId)).status).toBe("ACTIVE");
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("refuses a PENDING membership and another cooperative's officer", async () => {
    const pending = await farmerIn("u-f1", coopA);
    await expect(removeFarmer(officerA, pending.membershipId, "x")).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
    const active = await farmerIn("u-f2", coopA, "ACTIVE");
    await expect(removeFarmer(officerB, active.membershipId, "x")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("requires a reason", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await expect(removeFarmer(officerA, membershipId, " ")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("leaveCooperative", () => {
  it("moves the own ACTIVE membership to LEFT and keeps the rows", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await leaveCooperative(farmerActor("u-f1", coopA));
    expect((await statusOf(membershipId)).status).toBe("LEFT");
    expect(await prisma.farmerProfile.count({ where: { userId: "u-f1" } })).toBe(1);
    const audit = await auditFor("farmer.leave", membershipId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe("u-f1");
    expect(audit[0].meta).toEqual({
      membershipId,
      cooperativeId: coopA,
      from: "ACTIVE",
      to: "LEFT",
    });
  });

  it("is blocked by unfinished orders with UNFINISHED_ORDERS", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    hasUnfinishedOrders.mockResolvedValue(true);
    await expect(leaveCooperative(farmerActor("u-f1", coopA))).rejects.toMatchObject({
      code: "UNFINISHED_ORDERS",
    });
    expect((await statusOf(membershipId)).status).toBe("ACTIVE");
  });

  it("refuses a non-farmer actor", async () => {
    await expect(leaveCooperative(officerA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a farmer with no ACTIVE membership", async () => {
    await farmerIn("u-f1", coopA);
    await expect(leaveCooperative(farmerActor("u-f1", coopA))).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("leaves the user with no Actor once they have no other memberships", async () => {
    await farmerIn("u-f1", coopA, "ACTIVE");
    getSession.mockResolvedValue({
      user: { id: "u-f1", email: "u-f1@example.com", twoFactorEnabled: false },
      session: { id: "s1" },
    });
    expect(await getActor()).toMatchObject({ role: "FARMER", cooperativeId: coopA });
    await leaveCooperative(farmerActor("u-f1", coopA));
    expect(await getActor()).toBeNull();
    expect(await prisma.farmerProfile.count({ where: { userId: "u-f1" } })).toBe(1);
    expect(await prisma.membership.count({ where: { userId: "u-f1" } })).toBe(1);
  });
});

describe("rejoining", () => {
  it("removed_farmer_cannot_rejoin_same_cooperative", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await removeFarmer(officerA, membershipId, "Removed");
    const error = await joinViaLink(
      { userId: "u-f1" },
      await inviteToken(coopA),
      PROFILE,
      T,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "REMOVED_FROM_COOPERATIVE" });
    expect((await statusOf(membershipId)).status).toBe("REMOVED");
  });

  it("does not use up a single-use invite when the removed farmer is refused", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await removeFarmer(officerA, membershipId, "Removed");
    await prisma.inviteLink.create({
      data: { cooperativeId: coopA, token: "tok-mail", email: "u-f1@example.com", createdBy: "x" },
    });
    await expect(joinViaLink({ userId: "u-f1" }, "tok-mail", PROFILE, T)).rejects.toMatchObject({
      code: "REMOVED_FROM_COOPERATIVE",
    });
    const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { token: "tok-mail" } });
    expect(invite.usedAt).toBeNull();
  });

  it("a rejected farmer is also barred from the same cooperative", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA);
    await rejectFarmer(officerA, membershipId, "No");
    await expect(
      joinViaLink({ userId: "u-f1" }, await inviteToken(coopA), PROFILE, T),
    ).rejects.toMatchObject({ code: "REMOVED_FROM_COOPERATIVE" });
  });

  it("a removed farmer can still join a different cooperative", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await removeFarmer(officerA, membershipId, "Removed");
    await joinViaLink({ userId: "u-f1" }, await inviteToken(coopB), PROFILE, T);
    const rows = await prisma.membership.findMany({
      where: { userId: "u-f1" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((m) => [m.cooperativeId, m.status])).toEqual([
      [coopA, "REMOVED"],
      [coopB, "PENDING"],
    ]);
  });

  it("farmer_who_left_can_rejoin_same_cooperative", async () => {
    const { membershipId } = await farmerIn("u-f1", coopA, "ACTIVE");
    await leaveCooperative(farmerActor("u-f1", coopA));
    const again = await joinViaLink({ userId: "u-f1" }, await inviteToken(coopA), PROFILE, T);
    expect(again.membershipId).toBe(membershipId);
    expect(await statusOf(membershipId)).toMatchObject({ status: "PENDING", approvedAt: null });
  });
});

describe("listings", () => {
  it("lists pending farmers of the cooperative only, oldest first", async () => {
    const first = await farmerIn("u-f1", coopA);
    await farmerIn("u-f2", coopA);
    await farmerIn("u-f3", coopB);
    await farmerIn("u-f4", coopA, "ACTIVE");
    const list = await listPendingFarmers(officerA, coopA);
    expect(list.map((f) => f.userId)).toEqual(["u-f1", "u-f2"]);
    expect(list[0]).toMatchObject({
      membershipId: first.membershipId,
      cooperativeId: coopA,
      name: "User u-f1",
      crops: ["Maize"],
      hasBankAccount: false,
    });
    expect(JSON.stringify(list)).not.toMatch(/@example\.com|\+234/);
  });

  it("lists active farmers, leaving out those who left or were removed", async () => {
    await farmerIn("u-f1", coopA, "ACTIVE");
    await farmerIn("u-f2", coopA, "LEFT");
    await farmerIn("u-f3", coopA, "REMOVED");
    await farmerIn("u-f4", coopA);
    const list = await listActiveFarmers(officerA, coopA);
    expect(list.map((f) => f.userId)).toEqual(["u-f1"]);
  });

  it("ignores a stale FarmerProfile.cooperativeId", async () => {
    await farmerIn("u-f1", coopA, "ACTIVE");
    // The profile has moved on (as after leaving and joining elsewhere); the membership rules.
    await prisma.farmerProfile.update({
      where: { userId: "u-f1" },
      data: { cooperativeId: coopB },
    });
    const list = await listActiveFarmers(officerA, coopA);
    expect(list.map((f) => f.userId)).toEqual(["u-f1"]);
    expect(list[0].cooperativeId).toBe(coopA);
    expect(await listActiveFarmers(officerB, coopB)).toEqual([]);
  });

  it("refuses another cooperative's officer and farmers", async () => {
    await expect(listPendingFarmers(officerB, coopA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listActiveFarmers(officerB, coopA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listPendingFarmers(farmerActor("u-f1", coopA), coopA),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
