import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { joinViaLink } from "@/modules/farmers/service";
import { hasUnfinishedOrders } from "@/modules/farmers/orders-guard";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

const T = new Date("2031-06-10T12:00:00Z");

const PROFILE = {
  farmSizeHectares: "2.5",
  cropIds: [] as string[],
  state: "Ogun",
  lga: "Abeokuta North",
};

async function crops(...names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const row = await prisma.crop.create({ data: { name, nameKey: name.toLowerCase() } });
    ids.push(row.id);
  }
  return ids;
}

let coopA: string;
let coopB: string;

// A cooperative has at most one open shareable link, so reuse it.
async function shareableInvite(cooperativeId: string): Promise<string> {
  const open = await prisma.inviteLink.findFirst({
    where: { cooperativeId, email: null, revokedAt: null },
  });
  if (open) return open.token;
  const token = randomBytes(32).toString("base64url");
  await prisma.inviteLink.create({ data: { cooperativeId, token, createdBy: "u-officer" } });
  return token;
}

async function emailInvite(cooperativeId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.inviteLink.create({
    data: { cooperativeId, token, email, createdBy: "u-officer" },
  });
  return token;
}

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
  coopA = (await createTestCooperative({ name: "Coop A", status: "VERIFIED" })).id;
  coopB = (await createTestCooperative({ name: "Coop B", status: "VERIFIED" })).id;
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("joinViaLink", () => {
  it("creates one PENDING membership and one profile", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    const token = await shareableInvite(coopA);
    const cropIds = await crops("Maize", "Cassava");
    const { membershipId } = await joinViaLink({ userId: user.id }, token, { ...PROFILE, cropIds }, T);

    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      id: membershipId,
      role: "FARMER",
      cooperativeId: coopA,
      status: "PENDING",
      approvedAt: null,
    });
    const profiles = await prisma.farmerProfile.findMany({ where: { userId: user.id } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      cooperativeId: coopA,
      state: "Ogun",
      lga: "Abeokuta North",
      recipientCode: null,
      accountName: null,
    });
    expect(profiles[0].farmSizeHectares.toString()).toBe("2.5");
    const linked = await prisma.farmerProfile.findUniqueOrThrow({
      where: { userId: user.id },
      include: { crops: { orderBy: { nameKey: "asc" } } },
    });
    expect(linked.crops.map((c) => c.name)).toEqual(["Cassava", "Maize"]);

    // The audit log is append-only, so earlier runs' rows remain; scope by the new id.
    const audit = await prisma.auditLog.findMany({
      where: { action: "farmer.join", entityId: membershipId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(user.id);
    expect(audit[0].meta).toEqual({ membershipId, cooperativeId: coopA });
  });

  it("never marks a shareable link used, so many farmers can join through it", async () => {
    const token = await shareableInvite(coopA);
    for (const id of ["u-f1", "u-f2"]) {
      await createTestUser({ id });
      await joinViaLink({ userId: id }, token, PROFILE, T);
    }
    const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { token } });
    expect(invite.usedAt).toBeNull();
    expect(await prisma.membership.count({ where: { cooperativeId: coopA, role: "FARMER" } })).toBe(2);
  });

  it("farmer_cannot_join_second_cooperative", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    await joinViaLink({ userId: user.id }, await shareableInvite(coopA), PROFILE, T);
    const error = await joinViaLink(
      { userId: user.id },
      await shareableInvite(coopB),
      PROFILE,
      T,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "ALREADY_IN_COOPERATIVE" });
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.cooperativeId).toBe(coopA);
  });

  it("refuses an ACTIVE farmer too", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    await joinViaLink({ userId: user.id }, await shareableInvite(coopA), PROFILE, T);
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "ACTIVE" } });
    await expect(
      joinViaLink({ userId: user.id }, await shareableInvite(coopB), PROFILE, T),
    ).rejects.toMatchObject({ code: "ALREADY_IN_COOPERATIVE" });
  });

  it("farmer_who_left_can_join_another", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    await joinViaLink({ userId: user.id }, await shareableInvite(coopA), PROFILE, T);
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "LEFT" } });
    await joinViaLink(
      { userId: user.id },
      await shareableInvite(coopB),
      { ...PROFILE, cropIds: await crops("Yam") },
      T,
    );
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(memberships.map((m) => [m.cooperativeId, m.status])).toEqual([
      [coopA, "LEFT"],
      [coopB, "PENDING"],
    ]);
    // One profile per user: it moves to the new cooperative.
    const profiles = await prisma.farmerProfile.findMany({
      where: { userId: user.id },
      include: { crops: true },
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].cooperativeId).toBe(coopB);
    expect(profiles[0].crops.map((c) => c.name)).toEqual(["Yam"]);
  });

  it("farmer_can_rejoin_same_cooperative_after_leaving", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    const first = await joinViaLink({ userId: user.id }, await shareableInvite(coopA), PROFILE, T);
    await prisma.membership.update({
      where: { id: first.membershipId },
      data: { status: "LEFT", approvedAt: T },
    });
    const profileBefore = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    const again = await joinViaLink(
      { userId: user.id },
      await shareableInvite(coopA),
      { ...PROFILE, farmSizeHectares: "4" },
      T,
    );
    expect(again.membershipId).toBe(first.membershipId);
    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ status: "PENDING", approvedAt: null });
    const profile = await prisma.farmerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(profile.id).toBe(profileBefore.id);
    expect(profile.farmSizeHectares.toString()).toBe("4");
  });

  it("allows only one of two concurrent joins by the same user", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    const results = await Promise.allSettled([
      joinViaLink({ userId: user.id }, await shareableInvite(coopA), PROFILE, T),
      joinViaLink({ userId: user.id }, await shareableInvite(coopB), PROFILE, T),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "ALREADY_IN_COOPERATIVE",
    });
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.farmerProfile.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("email-bound invites", () => {
  it("accepts the invited email, case-insensitively, and marks the invite used", async () => {
    const user = await createTestUser({ id: "u-farmer", email: "Ada@Example.com" });
    const token = await emailInvite(coopA, "ada@example.com");
    await joinViaLink({ userId: user.id }, token, PROFILE, T);
    const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { token } });
    expect(invite.usedAt?.toISOString()).toBe(T.toISOString());
  });

  it("rejects another email with INVITE_EMAIL_MISMATCH", async () => {
    const user = await createTestUser({ id: "u-farmer", email: "someone@example.com" });
    const token = await emailInvite(coopA, "ada@example.com");
    const error = await joinViaLink({ userId: user.id }, token, PROFILE, T).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
    expect(await prisma.membership.count()).toBe(0);
    const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { token } });
    expect(invite.usedAt).toBeNull();
  });

  it("refuses a used single-use invite with INVITE_INVALID", async () => {
    const user = await createTestUser({ id: "u-farmer", email: "ada@example.com" });
    const token = await emailInvite(coopA, "ada@example.com");
    await joinViaLink({ userId: user.id }, token, PROFILE, T);
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: "LEFT" } });
    const error = await joinViaLink({ userId: user.id }, token, PROFILE, T).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ code: "INVITE_INVALID" });
  });

  it("does not use up the invite when the join fails", async () => {
    const user = await createTestUser({ id: "u-farmer", email: "ada@example.com" });
    await joinViaLink({ userId: user.id }, await shareableInvite(coopB), PROFILE, T);
    const token = await emailInvite(coopA, "ada@example.com");
    await expect(joinViaLink({ userId: user.id }, token, PROFILE, T)).rejects.toMatchObject({
      code: "ALREADY_IN_COOPERATIVE",
    });
    const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { token } });
    expect(invite.usedAt).toBeNull();
  });
});

describe("invite and cooperative checks", () => {
  it("refuses an unknown or revoked token", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    await expect(joinViaLink({ userId: user.id }, "nope", PROFILE, T)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    const token = await shareableInvite(coopA);
    await prisma.inviteLink.update({ where: { token }, data: { revokedAt: T } });
    await expect(joinViaLink({ userId: user.id }, token, PROFILE, T)).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
  });

  it("refuses a cooperative that is not verified", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    const pending = await createTestCooperative({ status: "PENDING" });
    await expect(
      joinViaLink({ userId: user.id }, await shareableInvite(pending.id), PROFILE, T),
    ).rejects.toMatchObject({ code: "COOPERATIVE_NOT_VERIFIED" });
  });
});

describe("profile validation", () => {
  const cases: Array<[string, Partial<typeof PROFILE>]> = [
    ["a farm size with three decimals", { farmSizeHectares: "1.234" }],
    ["a zero farm size", { farmSizeHectares: "0" }],
    ["a farm size over 100000", { farmSizeHectares: "100000.01" }],
    ["a non-numeric farm size", { farmSizeHectares: "two" }],
    ["an unknown state", { state: "Lagoss" }],
    ["21 crops", { cropIds: Array.from({ length: 21 }, (_, i) => `crop-${i}`) }],
    ["an empty crop id", { cropIds: [""] }],
    ["an empty LGA", { lga: " " }],
    ["an LGA over 80 characters", { lga: "x".repeat(81) }],
  ];

  for (const [label, override] of cases) {
    it(`rejects ${label} with ValidationError`, async () => {
      const user = await createTestUser({ id: "u-farmer" });
      const token = await shareableInvite(coopA);
      await expect(
        joinViaLink({ userId: user.id }, token, { ...PROFILE, ...override }, T),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await prisma.membership.count()).toBe(0);
    });
  }

  it("accepts the bounds", async () => {
    const user = await createTestUser({ id: "u-farmer" });
    await joinViaLink(
      { userId: user.id },
      await shareableInvite(coopA),
      {
        farmSizeHectares: "100000",
        cropIds: await crops(...Array.from({ length: 20 }, (_, i) => `Crop ${i}`)),
        state: "FCT",
        lga: "x".repeat(80),
      },
      T,
    );
    expect(await prisma.farmerProfile.count()).toBe(1);
  });
});

describe("hasUnfinishedOrders", () => {
  it("returns false until Phase 5 adds orders", async () => {
    await expect(hasUnfinishedOrders("u-anyone")).resolves.toBe(false);
  });
});
