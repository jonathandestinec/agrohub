import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
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
      crops: 6,
      units: 4,
      prices: 12,
    });
    expect(second.password).toBeNull();
  });

  it("seeds crops, units and two weeks of demo prices on the public board", async () => {
    await seed();
    const crops = await prisma.crop.findMany({ orderBy: { nameKey: "asc" } });
    expect(crops.map((c) => c.name)).toEqual(["Cassava", "Maize", "Rice", "Sorghum", "Soybeans", "Yam"]);
    const units = await prisma.unit.findMany({ orderBy: { nameKey: "asc" } });
    expect(units.map((u) => u.name)).toEqual(["Bag", "Basket", "kg", "Tonne"]);
    const weeks = await prisma.pricePoint.findMany({ distinct: ["weekOf"], orderBy: { weekOf: "asc" } });
    expect(weeks.map((w) => w.weekOf.toISOString().slice(0, 10))).toEqual(["2026-10-19", "2026-10-26"]);
  });
});
