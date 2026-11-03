import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { listPublicBoard } from "@/modules/board/service";
import { SEED, seed } from "../../prisma/seed";
import { cleanDatabase } from "./helpers";

async function clean() {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await cleanDatabase();
}

beforeEach(async () => {
  await clean();
  fakeOutbox.clear();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

async function counts() {
  return {
    users: await prisma.user.count(),
    accounts: await prisma.account.count(),
    cooperatives: await prisma.cooperative.count(),
    memberships: await prisma.membership.count(),
    profiles: await prisma.farmerProfile.count(),
    crops: await prisma.crop.count(),
    units: await prisma.unit.count(),
    prices: await prisma.pricePoint.count(),
  };
}

describe("seed", () => {
  it("creates a verified admin, a VERIFIED cooperative with an officer, and a PENDING farmer", async () => {
    const result = await seed();

    expect(result.password).toEqual(expect.any(String));
    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(users.map((u) => [u.email, u.emailVerified, u.twoFactorEnabled])).toEqual([
      [SEED.admin.email, true, false],
      [SEED.board.email, true, false],
      [SEED.farmer.email, true, false],
      [SEED.officer.email, true, false],
    ]);
    for (const u of users) expect(u.email).toMatch(/@example\.com$/);

    const cooperative = await prisma.cooperative.findUniqueOrThrow({
      where: { registrationNumber: SEED.cooperative.registrationNumber },
    });
    expect(cooperative.status).toBe("VERIFIED");
    expect(cooperative.verifiedAt).not.toBeNull();

    const memberships = await prisma.membership.findMany({
      include: { user: { select: { email: true } } },
    });
    expect(
      memberships
        .map((m) => [m.user.email, m.role, m.status, m.cooperativeId])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      [SEED.admin.email, "ADMIN", "ACTIVE", null],
      [SEED.board.email, "BOARD_ADMIN", "ACTIVE", null],
      [SEED.farmer.email, "FARMER", "PENDING", cooperative.id],
      [SEED.officer.email, "OFFICER", "ACTIVE", cooperative.id],
    ]);
    const profile = await prisma.farmerProfile.findFirstOrThrow();
    expect(profile.cooperativeId).toBe(cooperative.id);
  });

  it("hashes passwords through Better Auth, so the seeded users can sign in", async () => {
    const { password } = await seed();
    const result = await auth.api.signInEmail({
      body: { email: SEED.officer.email, password: password! },
    });
    expect(result.user.email).toBe(SEED.officer.email);
  });

  it("is idempotent: a second run adds no rows and prints no new password", async () => {
    await seed();
    const before = await counts();
    const second = await seed();

    expect(await counts()).toEqual(before);
    expect(before).toEqual({
      users: 4,
      accounts: 4,
      cooperatives: 1,
      memberships: 4,
      profiles: 1,
      crops: 12,
      units: 8,
      prices: 28,
    });
    expect(second.password).toBeNull();
  });

  it("sets the cooperative's cut and links the farmer to two crops, once", async () => {
    await seed();
    await seed();
    const cooperative = await prisma.cooperative.findUniqueOrThrow({
      where: { registrationNumber: SEED.cooperative.registrationNumber },
    });
    expect(cooperative.cutBps).toBe(500);
    const profile = await prisma.farmerProfile.findFirstOrThrow({
      include: { crops: { orderBy: { nameKey: "asc" } } },
    });
    expect(profile.crops.map((c) => c.name)).toEqual(["Maize", "Sorghum"]);
  });

  it("seeds crops, units and the October 2026 market prices on the public board", async () => {
    await seed();
    const crops = await prisma.crop.findMany();
    expect(crops.map((c) => c.name).sort()).toEqual([
      "Beans", "Cassava", "Garri", "Maize", "Onions", "Paddy rice",
      "Pepper", "Rice", "Sorghum", "Soybeans", "Tomatoes", "Yam",
    ]);
    const units = await prisma.unit.findMany();
    expect(units.map((u) => u.name).sort()).toEqual([
      "100kg bag", "25kg basket", "50kg bag", "50kg basket", "Bag", "Tonne", "Tuber", "kg",
    ]);
    const weeks = await prisma.pricePoint.findMany({ distinct: ["weekOf"], orderBy: { weekOf: "asc" } });
    expect(weeks.map((w) => w.weekOf.toISOString().slice(0, 10))).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("puts each observation in the week it was taken, with the week before where there was one", async () => {
    await seed();
    const board = await listPublicBoard({}, new Date("2026-11-03T12:00:00Z"));
    expect(board).toHaveLength(20);
    expect(board).toContainEqual(
      expect.objectContaining({
        crop: "Maize",
        unit: "100kg bag",
        market: SEED.markets.exchange,
        weekOf: "2026-10-26",
        priceKobo: 3_263_500,
        previousKobo: 3_187_900,
        previousWeekOf: "2026-10-19",
      }),
    );
    expect(board).toContainEqual(
      expect.objectContaining({
        crop: "Maize",
        unit: "50kg bag",
        market: SEED.markets.lagos,
        weekOf: "2026-10-26",
        priceKobo: 5_500_000,
        previousKobo: null,
      }),
    );
  });

  it("re_seed_leaves_board_admin_changes_alone", async () => {
    await seed();
    const maize = await prisma.crop.findUniqueOrThrow({ where: { nameKey: "maize" } });
    await prisma.crop.update({ where: { id: maize.id }, data: { active: false } });
    await prisma.crop.update({ where: { nameKey: "sorghum" }, data: { name: "Guinea corn", nameKey: "guinea corn" } });
    const point = await prisma.pricePoint.findFirstOrThrow({ where: { cropId: { not: maize.id } } });
    await prisma.pricePoint.update({ where: { id: point.id }, data: { priceKobo: 1_234_500 } });
    const before = await counts();

    await expect(seed()).resolves.toMatchObject({ password: null });

    expect(await counts()).toEqual(before);
    expect((await prisma.pricePoint.findUniqueOrThrow({ where: { id: point.id } })).priceKobo).toBe(1_234_500);
  });
});
