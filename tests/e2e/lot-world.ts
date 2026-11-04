import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Test setup for the lot journey: wires two signed-up users into a VERIFIED cooperative with
// a 5% cut (one ACTIVE officer, one ACTIVE farmer with a payout account) and puts a crop, a
// unit and this week's board price on the board. The Phase 1 and 2 journeys already prove
// those steps through the screens. Runs under tsx in a child process, like grant.ts.
const SCRIPT = `(async () => {
  const { prisma } = await import("./src/lib/db.ts");
  const { weekStart } = await import("./src/modules/board/week.ts");
  const e = process.env;
  try {
    const officer = await prisma.user.findUniqueOrThrow({ where: { email: e.E2E_OFFICER } });
    const farmer = await prisma.user.findUniqueOrThrow({ where: { email: e.E2E_FARMER } });
    const now = new Date();
    const coop = await prisma.cooperative.create({ data: {
      name: e.E2E_COOP, registrationNumber: "RC-" + e.E2E_TAG, state: "Kaduna", lga: "Zaria",
      certificateExpiresAt: new Date("2030-01-01T00:00:00Z"), status: "VERIFIED",
      submittedAt: now, verifiedAt: now, cutBps: 500,
      ...(e.E2E_COOP_ACCOUNT ? { recipientCode: "RCP_COOP_" + e.E2E_TAG, accountName: e.E2E_COOP_ACCOUNT, bankName: "Guaranty Trust Bank" } : {}) } });
    await prisma.membership.create({ data: { userId: officer.id, role: "OFFICER", cooperativeId: coop.id, status: "ACTIVE", approvedAt: now } });
    await prisma.membership.create({ data: { userId: farmer.id, role: "FARMER", cooperativeId: coop.id, status: "ACTIVE", approvedAt: now } });
    await prisma.farmerProfile.create({ data: { userId: farmer.id, cooperativeId: coop.id, farmSizeHectares: "2.5",
      state: "Kaduna", lga: "Zaria", recipientCode: "RCP_" + e.E2E_TAG, accountName: farmer.name.toUpperCase() } });
    const crop = await prisma.crop.create({ data: { name: e.E2E_CROP, nameKey: e.E2E_CROP.toLowerCase() } });
    const unit = await prisma.unit.create({ data: { name: e.E2E_UNIT, nameKey: e.E2E_UNIT.toLowerCase() } });
    await prisma.pricePoint.create({ data: { cropId: crop.id, unitId: unit.id, market: "Zaria market",
      marketKey: "zaria market", weekOf: weekStart(now), priceKobo: 6000000, recordedByUserId: officer.id } });
    if (e.E2E_LIVE_LOT) {
      // A lot already approved (Phase 3's journey proves screening through the screens).
      const live = JSON.parse(e.E2E_LIVE_LOT);
      const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14));
      const lot = await prisma.lot.create({ data: {
        cooperativeId: coop.id, farmerUserId: farmer.id, cropId: crop.id, unitId: unit.id,
        quantity: live.quantity, grade: "A", pickupState: "Kaduna", pickupLga: "Zaria",
        askKobo: live.askKobo, floorKobo: live.floorKobo, quotedCutBps: 500, quotedFeeBps: 300,
        status: "LIVE", availableUntil: until, minOrderQty: live.minOrderQty,
        screenedByUserId: officer.id, approvedAt: now } });
      await prisma.lotContribution.create({ data: { lotId: lot.id, farmerUserId: farmer.id, quantity: live.quantity } });
      await prisma.lotFeeTerms.create({ data: { lotId: lot.id, cooperativeCutBps: 500, platformFeeBps: 300, lockedAt: now } });
    }
  } finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });`;

export async function setUpLotWorld(input: {
  tag: string;
  cooperative: string;
  crop: string;
  unit: string;
  officerEmail: string;
  farmerEmail: string;
  // When given, also creates a LIVE lot of this crop and unit (grade A, pickup in Zaria).
  liveLot?: { quantity: number; askKobo: number; floorKobo: number; minOrderQty: number };
  // When set, the cooperative already has a payout account under this name.
  cooperativeAccountName?: string;
}): Promise<void> {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await run(process.execPath, [cli, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ?? "postgresql://agrohub:agrohub@localhost:5432/agrohub_test",
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: "http://localhost:3100",
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
      E2E_TAG: input.tag,
      E2E_COOP: input.cooperative,
      E2E_CROP: input.crop,
      E2E_UNIT: input.unit,
      E2E_OFFICER: input.officerEmail,
      E2E_FARMER: input.farmerEmail,
      E2E_LIVE_LOT: input.liveLot ? JSON.stringify(input.liveLot) : "",
      E2E_COOP_ACCOUNT: input.cooperativeAccountName ?? "",
    },
  });
}
