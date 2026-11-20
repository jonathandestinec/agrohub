import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { E2E_DATABASE_URL, E2E_ORIGIN } from "./base-url";

const run = promisify(execFile);

// Puts one more lot waiting for screening into a cooperative made by setUpLotWorld, as if the
// farmer had just submitted it (the submit form is proved by lots.spec.ts). Runs under tsx in a
// child process, like lot-world.ts.
const SCRIPT = `(async () => {
  const { prisma } = await import("./src/lib/db.ts");
  const e = process.env;
  try {
    const coop = await prisma.cooperative.findFirstOrThrow({ where: { registrationNumber: "RC-" + e.E2E_TAG } });
    const farmer = await prisma.user.findUniqueOrThrow({ where: { email: e.E2E_FARMER } });
    const crop = await prisma.crop.findFirstOrThrow({ where: { nameKey: e.E2E_CROP.toLowerCase() } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { nameKey: e.E2E_UNIT.toLowerCase() } });
    const now = new Date();
    const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14));
    const lot = await prisma.lot.create({ data: {
      cooperativeId: coop.id, farmerUserId: farmer.id, cropId: crop.id, unitId: unit.id,
      quantity: Number(e.E2E_QUANTITY), grade: "A", pickupState: "Kaduna", pickupLga: "Zaria",
      askKobo: 6500000, floorKobo: 6000000, quotedCutBps: 500, quotedFeeBps: 300,
      status: "PENDING_REVIEW", availableUntil: until, minOrderQty: 1 } });
    await prisma.lotContribution.create({ data: { lotId: lot.id, farmerUserId: farmer.id, quantity: Number(e.E2E_QUANTITY) } });
  } finally { await prisma.$disconnect(); }
})().catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });`;

export async function addPendingLot(input: {
  tag: string;
  farmerEmail: string;
  crop: string;
  unit: string;
  quantity: number;
}): Promise<void> {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  await run(process.execPath, [cli, "--eval", SCRIPT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "test-only-secret-not-for-real-use-0123456789",
      BETTER_AUTH_URL: E2E_ORIGIN,
      CRON_SECRET: "test-only-cron-secret",
      APP_ENV: "local",
      E2E_TAG: input.tag,
      E2E_FARMER: input.farmerEmail,
      E2E_CROP: input.crop,
      E2E_UNIT: input.unit,
      E2E_QUANTITY: String(input.quantity),
    },
  });
}
