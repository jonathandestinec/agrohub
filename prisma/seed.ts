// Demo data for local and staging:
//   npm run db:seed                                   (local Docker database)
//   APP_ENV=staging DATABASE_URL=<url> npm run db:seed -- --allow-remote   (staging; never production)
// Creates one admin and one board admin (two-factor off, so /two-factor enrolment shows),
// one VERIFIED cooperative with an ACTIVE officer, one PENDING farmer with a profile, the
// crop and unit lists, and real October 2026 market prices on the board (board data only into
// an empty crop list). It also builds the demo journey (seedJourney below): an ACTIVE grower
// with four live lots, an accepted offer, and orders at every stage. Re-running it adds nothing. tsx never loads .env, so the database is DATABASE_URL or local Docker.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SignUpEmailBody } from "@/lib/auth";

// The same default as prisma.config.ts: with nothing set, only the local dev database.
const LOCAL_DEV_DATABASE_URL = "postgresql://agrohub:agrohub@localhost:5432/agrohub";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const SEED = {
  admin: { name: "Seed Admin", email: "seed-admin@example.com" },
  board: { name: "Seed Board Admin", email: "seed-board@example.com" },
  officer: { name: "Seed Officer", email: "seed-officer@example.com" },
  farmer: { name: "Seed Farmer", email: "seed-farmer@example.com" },
  buyer: { name: "Seed Buyer", email: "seed-buyer@example.com" },
  // The demo journey's second buyer and the ACTIVE farmer who owns its lots (the PENDING
  // farmer above stays pending, for the officer's approval screen).
  buyerTwo: { name: "Seed Buyer Two", email: "seed-buyer2@example.com" },
  grower: { name: "Seed Grower", email: "seed-grower@example.com" },
  // Obviously fake payout accounts: no bank data of any kind.
  bank: { grower: "RCP_seed_grower", cooperative: "RCP_seed_cooperative" },
  // The lots of the demo journey, all from the seeded cooperative and its grower, priced
  // within 20% of the newest board price of the same crop and unit.
  lots: [
    { key: "maize", crop: "Maize", unit: "100kg bag", quantity: 200, askKobo: 3_300_000, floorKobo: 3_100_000, minOrderQty: 10 },
    { key: "rice", crop: "Paddy rice", unit: "100kg bag", quantity: 80, askKobo: 4_200_000, floorKobo: 3_900_000, minOrderQty: 5 },
    { key: "soybeans", crop: "Soybeans", unit: "100kg bag", quantity: 60, askKobo: 5_200_000, floorKobo: 4_900_000, minOrderQty: 5 },
    { key: "sorghum", crop: "Sorghum", unit: "100kg bag", quantity: 50, askKobo: 3_900_000, floorKobo: 3_600_000, minOrderQty: 5 },
  ],
  phone: "+2348000000000",
  cooperative: {
    name: "Seed Demo Farmers Cooperative",
    registrationNumber: "RC-SEED-0001",
    state: "Kaduna",
    lga: "Zaria",
    certificateExpiresAt: new Date("2030-12-31T00:00:00Z"),
  },
  profile: { farmSizeHectares: "2.50", crops: ["Maize", "Sorghum"], state: "Kaduna", lga: "Zaria" },
  crops: [
    "Maize", "Sorghum", "Rice", "Paddy rice", "Soybeans", "Beans",
    "Cassava", "Garri", "Yam", "Tomatoes", "Pepper", "Onions",
  ],
  units: ["kg", "Bag", "Tonne", "Tuber", "50kg bag", "100kg bag", "25kg basket", "50kg basket"],
  markets: {
    exchange: "Commodity exchange, national spot",
    lagos: "Lagos markets (Mile 12, Mushin, Daleko, Oyingbo)",
    lagosTracker: "Lagos State price tracker",
    northCentral: "North-Central markets",
    northWest: "North-West markets",
    southWest: "South-West markets",
  },
  // Real October 2026 prices, in kobo, each in the week it was observed (fixed past weeks,
  // so re-running adds nothing). Where a source gave a range, the midpoint. Sources:
  //   exchange: Mansa Markets daily exchange spot, NGN/kg averaged over the week, x100 for
  //     a 100kg bag (mansamarkets.com/blog/<crop>-price-in-nigeria-today). Rice is paddy.
  //   lagos: Nairametrics survey of 67 staples for October, published 1 Nov 2026.
  //   lagosTracker: Lagos State Ministry of Agriculture price tracker, 4th week of October.
  //   zones: ColdHubs weekly fresh produce report, 12-17 and 19-24 Oct 2026.
  prices: [
    { crop: "Maize", unit: "100kg bag", market: "exchange", weekOf: "2026-10-19", priceKobo: 3_187_900 },
    { crop: "Maize", unit: "100kg bag", market: "exchange", weekOf: "2026-10-26", priceKobo: 3_263_500 },
    { crop: "Paddy rice", unit: "100kg bag", market: "exchange", weekOf: "2026-10-19", priceKobo: 4_508_900 },
    { crop: "Paddy rice", unit: "100kg bag", market: "exchange", weekOf: "2026-10-26", priceKobo: 4_084_200 },
    { crop: "Sorghum", unit: "100kg bag", market: "exchange", weekOf: "2026-10-19", priceKobo: 3_664_400 },
    { crop: "Sorghum", unit: "100kg bag", market: "exchange", weekOf: "2026-10-26", priceKobo: 3_839_600 },
    { crop: "Soybeans", unit: "100kg bag", market: "exchange", weekOf: "2026-10-19", priceKobo: 5_100_800 },
    { crop: "Soybeans", unit: "100kg bag", market: "exchange", weekOf: "2026-10-26", priceKobo: 5_085_200 },
    // Yellow and white maize, white garri, brown beans, short-grain rice, dry onions.
    { crop: "Maize", unit: "50kg bag", market: "lagos", weekOf: "2026-10-26", priceKobo: 5_500_000 },
    { crop: "Garri", unit: "50kg bag", market: "lagos", weekOf: "2026-10-26", priceKobo: 2_100_000 },
    { crop: "Beans", unit: "50kg bag", market: "lagos", weekOf: "2026-10-26", priceKobo: 11_000_000 },
    { crop: "Rice", unit: "50kg bag", market: "lagos", weekOf: "2026-10-26", priceKobo: 4_800_000 },
    { crop: "Onions", unit: "Bag", market: "lagos", weekOf: "2026-10-26", priceKobo: 22_000_000 },
    // Long-grain rice, medium yam tuber, tomatoes, rodo pepper and onions by the kg.
    { crop: "Rice", unit: "50kg bag", market: "lagosTracker", weekOf: "2026-10-26", priceKobo: 5_300_000 },
    { crop: "Yam", unit: "Tuber", market: "lagosTracker", weekOf: "2026-10-26", priceKobo: 250_000 },
    { crop: "Tomatoes", unit: "kg", market: "lagosTracker", weekOf: "2026-10-26", priceKobo: 180_000 },
    { crop: "Pepper", unit: "kg", market: "lagosTracker", weekOf: "2026-10-26", priceKobo: 200_000 },
    { crop: "Onions", unit: "kg", market: "lagosTracker", weekOf: "2026-10-26", priceKobo: 130_000 },
    // The report gave no earlier week for North-West and South-West tomatoes.
    { crop: "Tomatoes", unit: "50kg basket", market: "northCentral", weekOf: "2026-10-12", priceKobo: 1_250_000 },
    { crop: "Tomatoes", unit: "50kg basket", market: "northCentral", weekOf: "2026-10-19", priceKobo: 3_250_000 },
    { crop: "Tomatoes", unit: "50kg basket", market: "northWest", weekOf: "2026-10-19", priceKobo: 3_750_000 },
    { crop: "Tomatoes", unit: "50kg basket", market: "southWest", weekOf: "2026-10-19", priceKobo: 5_750_000 },
    { crop: "Pepper", unit: "25kg basket", market: "northCentral", weekOf: "2026-10-12", priceKobo: 2_250_000 },
    { crop: "Pepper", unit: "25kg basket", market: "northCentral", weekOf: "2026-10-19", priceKobo: 2_250_000 },
    { crop: "Pepper", unit: "25kg basket", market: "northWest", weekOf: "2026-10-12", priceKobo: 1_650_000 },
    { crop: "Pepper", unit: "25kg basket", market: "northWest", weekOf: "2026-10-19", priceKobo: 2_400_000 },
    { crop: "Pepper", unit: "25kg basket", market: "southWest", weekOf: "2026-10-12", priceKobo: 3_500_000 },
    { crop: "Pepper", unit: "25kg basket", market: "southWest", weekOf: "2026-10-19", priceKobo: 4_250_000 },
  ],
} as const;

export type SeedTarget = { ok: boolean; host: string; database: string; reason?: string };

// Pure: decides whether the seed may write to this database. The result names only the
// host and database, never the user or password, so it is safe to print.
export function checkSeedTarget(input: {
  databaseUrl: string;
  appEnv: string | undefined;
  allowRemote: boolean;
}): SeedTarget {
  let host = "unknown";
  let database = "unknown";
  try {
    const url = new URL(input.databaseUrl);
    host = url.hostname;
    database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "unknown";
    // libpq lets ?host= override the hostname, so the host checked below would not be
    // the host connected to. Such a URL is refused outright.
    if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === "host")) {
      return {
        ok: false,
        host,
        database,
        reason: "DATABASE_URL has a host query parameter; put the host in the URL itself",
      };
    }
  } catch {
    return { ok: false, host, database, reason: "DATABASE_URL is not a valid URL" };
  }
  if (input.appEnv === "production") {
    return { ok: false, host, database, reason: "APP_ENV is production; the seed never runs there" };
  }
  if (!LOCAL_HOSTS.has(host)) {
    // A remote database is seeded only on purpose: the flag AND APP_ENV=staging in the shell.
    if (!input.allowRemote || input.appEnv !== "staging") {
      return {
        ok: false,
        host,
        database,
        reason:
          "the host is not localhost; to seed staging, export APP_ENV=staging and pass --allow-remote",
      };
    }
  }
  return { ok: true, host, database };
}

// App modules are imported lazily: src/lib/env.ts validates on import, and the CLI below
// sets its variables first. Returns the password when it created any user, else null.
export async function seed(): Promise<{ password: string | null; created: string[] }> {
  const [{ prisma }, { auth }, { addMembership }, catalog, { recordPrice }, { nameKeyOf }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/lib/auth"),
      import("@/modules/identity/service"),
      import("@/modules/catalog/service"),
      import("@/modules/board/service"),
      import("@/modules/catalog/schema"),
    ]);
  const password = randomBytes(12).toString("base64url");
  const created: string[] = [];

  // Through Better Auth, so the password is hashed exactly as sign-up hashes it.
  async function ensureUser(person: { name: string; email: string }): Promise<string> {
    let user = await prisma.user.findUnique({ where: { email: person.email } });
    if (!user) {
      // `consent` is read by the user-create hook in src/lib/auth.ts.
      const body: SignUpEmailBody = {
        name: person.name,
        email: person.email,
        password,
        phone: SEED.phone,
        consent: true,
      };
      await auth.api.signUpEmail({ body });
      created.push(person.email);
      user = await prisma.user.findUniqueOrThrow({ where: { email: person.email } });
    }
    if (!user.emailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    }
    return user.id;
  }

  async function ensureMembership(input: {
    userId: string;
    role: "ADMIN" | "BOARD_ADMIN" | "OFFICER" | "FARMER" | "BUYER";
    cooperativeId?: string;
    status: "ACTIVE" | "PENDING";
  }): Promise<void> {
    const existing = await prisma.membership.findFirst({
      where: { userId: input.userId, role: input.role, cooperativeId: input.cooperativeId ?? null },
    });
    if (!existing) await addMembership(input);
  }

  const adminId = await ensureUser(SEED.admin);
  const boardId = await ensureUser(SEED.board);
  const officerId = await ensureUser(SEED.officer);
  const farmerId = await ensureUser(SEED.farmer);
  const buyerId = await ensureUser(SEED.buyer);
  const growerId = await ensureUser(SEED.grower);
  const buyerTwoId = await ensureUser(SEED.buyerTwo);

  const now = new Date();
  const cooperative = await prisma.cooperative.upsert({
    where: { registrationNumber: SEED.cooperative.registrationNumber },
    // A 5% cut, the default maximum; created once, so an officer's later change sticks.
    create: { ...SEED.cooperative, status: "VERIFIED", submittedAt: now, verifiedAt: now, cutBps: 500 },
    update: {},
  });

  await ensureMembership({ userId: adminId, role: "ADMIN", status: "ACTIVE" });
  await ensureMembership({
    userId: officerId,
    role: "OFFICER",
    cooperativeId: cooperative.id,
    status: "ACTIVE",
  });
  await ensureMembership({
    userId: farmerId,
    role: "FARMER",
    cooperativeId: cooperative.id,
    status: "PENDING",
  });
  await prisma.farmerProfile.upsert({
    where: { userId: farmerId },
    create: {
      userId: farmerId,
      cooperativeId: cooperative.id,
      farmSizeHectares: SEED.profile.farmSizeHectares,
      state: SEED.profile.state,
      lga: SEED.profile.lga,
    },
    update: {},
  });

  await ensureMembership({ userId: boardId, role: "BOARD_ADMIN", status: "ACTIVE" });
  await ensureMembership({ userId: buyerId, role: "BUYER", status: "ACTIVE" });
  await ensureMembership({ userId: buyerTwoId, role: "BUYER", status: "ACTIVE" });
  await ensureMembership({ userId: growerId, role: "FARMER", cooperativeId: cooperative.id, status: "ACTIVE" });
  // Board data is seeded once, into an empty crop list. After that it belongs to the board
  // admins: a re-run never re-creates a renamed crop, prices a hidden one, or reverts a
  // corrected price.
  async function seedBoard(): Promise<void> {
  // Crops, units and prices go through the services, as the seeded board admin would.
  const board = { userId: boardId, role: "BOARD_ADMIN", cooperativeId: null, twoFactorEnabled: true } as const;
  async function ensureItem(kind: "crop" | "unit", name: string): Promise<string> {
    const where = { nameKey: nameKeyOf(name) };
    const existing =
      kind === "crop" ? await prisma.crop.findUnique({ where }) : await prisma.unit.findUnique({ where });
    if (existing) return existing.id;
    const item =
      kind === "crop"
        ? await catalog.createCrop(board, { name })
        : await catalog.createUnit(board, { name });
    return item.id;
  }
  const cropIds = new Map<string, string>();
  for (const name of SEED.crops) cropIds.set(name, await ensureItem("crop", name));
  // The seeded farmer grows two of the new crops.
  await prisma.farmerProfile.update({
    where: { userId: farmerId },
    data: { crops: { connect: SEED.profile.crops.map((name) => ({ id: cropIds.get(name)! })) } },
  });
  const unitIds = new Map<string, string>();
  for (const name of SEED.units) unitIds.set(name, await ensureItem("unit", name));
  for (const { crop, unit, market, weekOf, priceKobo } of SEED.prices) {
    // recordPrice upserts and writes no audit row when the price is unchanged.
    await recordPrice(board, {
      cropId: cropIds.get(crop)!,
      unitId: unitIds.get(unit)!,
      market: SEED.markets[market],
      weekOf,
      priceKobo,
    });
  }
  }
  if ((await prisma.crop.count()) === 0) await seedBoard();

  await seedJourney({ cooperativeId: cooperative.id, officerId, growerId, buyerId, buyerTwoId });

  return { password: created.length > 0 ? password : null, created };
}

// The Phase 3-5 demo journey: four live lots, an accepted offer, and one order at each stage.
// Everything goes through the module services with the right Actor and an explicit `now` in the
// past, so the rows cannot drift from the business rules. Written directly (no service exists
// for them, or it would call a real provider): the farmer's and the cooperative's fake payout
// account codes, each lot's createdAt (submitLot stamps the real time), the accepted offer's
// 7-day pay-by (the service gives 24 hours), and the payment confirmation, which calls
// confirmPayment as the webhook does but without a PaystackEvent row (the webhook handler
// cannot be given a past time). Each piece is created once: a re-run finds it and adds nothing.
async function seedJourney(ids: {
  cooperativeId: string;
  officerId: string;
  growerId: string;
  buyerId: string;
  buyerTwoId: string;
}): Promise<void> {
  const [{ prisma }, catalog, marketplace, orders, payments, { fakeSettle }, { addDays, lagosDateKey }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/modules/catalog/service"),
      import("@/modules/marketplace/service"),
      import("@/modules/orders/service"),
      import("@/modules/payments/service"),
      import("@/lib/paystack"),
      import("@/lib/lagos-date"),
    ]);
  type Actor = import("@/modules/identity/policies").Actor;
  const T = new Date();
  const DAY = 86_400_000;
  // A moment `days` ago, plus some minutes.
  const ago = (days: number, minutes = 0) => new Date(T.getTime() - days * DAY + minutes * 60_000);

  const farmer: Actor = { userId: ids.growerId, role: "FARMER", cooperativeId: ids.cooperativeId, twoFactorEnabled: false };
  const officer: Actor = { userId: ids.officerId, role: "OFFICER", cooperativeId: ids.cooperativeId, twoFactorEnabled: true };
  const buyer1: Actor = { userId: ids.buyerId, role: "BUYER", cooperativeId: null, twoFactorEnabled: false };
  const buyer2: Actor = { userId: ids.buyerTwoId, role: "BUYER", cooperativeId: null, twoFactorEnabled: false };

  // Fake payout accounts, set once (an account an officer or farmer already set is kept).
  await prisma.cooperative.updateMany({
    where: { id: ids.cooperativeId, recipientCode: null },
    data: { recipientCode: SEED.bank.cooperative, accountName: "SEED DEMO COOPERATIVE", bankName: "Seed Demo Bank" },
  });
  await prisma.farmerProfile.upsert({
    where: { userId: ids.growerId },
    create: {
      userId: ids.growerId,
      cooperativeId: ids.cooperativeId,
      farmSizeHectares: "4.00",
      state: SEED.profile.state,
      lga: SEED.profile.lga,
      recipientCode: SEED.bank.grower,
      accountName: "SEED GROWER",
      crops: { connect: SEED.lots.map((l) => ({ nameKey: l.crop.toLowerCase() })) },
    },
    update: {},
  });

  // JPEG magic bytes only; the seed has no bucket to put a picture in (see the pull request).
  const photo = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), contentType: "image/jpeg" };
  const lotIds = new Map<string, string>();
  for (const spec of SEED.lots) {
    const crop = await prisma.crop.findUnique({ where: { nameKey: spec.crop.toLowerCase() } });
    const unit = await prisma.unit.findUnique({ where: { nameKey: spec.unit.toLowerCase() } });
    if (!crop || !unit) continue; // a board admin renamed or removed it: skip rather than invent
    const existing = await prisma.lot.findFirst({
      where: { cooperativeId: ids.cooperativeId, farmerUserId: ids.growerId, cropId: crop.id, unitId: unit.id },
    });
    if (existing) {
      lotIds.set(spec.key, existing.id);
      continue;
    }
    const submitted = await catalog.submitLot(
      farmer,
      {
        cropId: crop.id,
        unitId: unit.id,
        quantity: spec.quantity,
        grade: "A",
        pickupState: "Kaduna",
        pickupLga: "Zaria",
        pickupNote: "Collect at the cooperative store in Zaria",
        askKobo: spec.askKobo,
        floorKobo: spec.floorKobo,
        note: `Dry, cleaned ${spec.crop.toLowerCase()} from this season's harvest.`,
        availableUntil: addDays(lagosDateKey(T), 45),
      },
      [photo],
      ago(12),
    );
    await prisma.lot.update({ where: { id: submitted.id }, data: { createdAt: ago(12) } });
    await catalog.approveLot(officer, submitted.id, { minOrderQty: spec.minOrderQty }, ago(12, 60));
    lotIds.set(spec.key, submitted.id);
  }

  // An accepted offer, ready to be checked out: the buyer offers below the ask, above the floor.
  const maizeId = lotIds.get("maize");
  if (maizeId && !(await prisma.offer.findFirst({ where: { lotId: maizeId, buyerUserId: ids.buyerId } }))) {
    const offer = await marketplace.makeOffer(buyer1, { lotId: maizeId, quantity: 20, offeredKobo: 3_200_000 }, T);
    await marketplace.respondToOffer(officer, offer.id, { decision: "ACCEPT" }, T);
    // The service holds an accepted offer 24 hours; the demo keeps it open for a week.
    await prisma.offer.update({ where: { id: offer.id }, data: { payByAt: new Date(T.getTime() + 7 * DAY) } });
  }

  // Checks out `quantity` of a lot at `at`, and has the buyer pay on Paystack's (fake) page.
  async function checkout(actor: Actor, lotId: string, quantity: number, at: Date): Promise<string> {
    const { orderId } = await orders.startCheckout(actor, { source: "LOT", lotId, quantity }, at);
    return orderId;
  }
  async function pay(orderId: string, at: Date): Promise<void> {
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    fakeSettle(payment.reference, "success", undefined, at);
    await payments.confirmPayment(payment.reference, at);
  }
  // A stage is created once per buyer and lot: any order of that pair means it is there.
  async function missing(lotKey: string, actor: Actor): Promise<string | null> {
    const lotId = lotIds.get(lotKey);
    if (!lotId) return null;
    return (await prisma.order.count({ where: { lotId, buyerUserId: actor.userId } })) === 0 ? lotId : null;
  }

  // Awaiting payment. Its 15-minute reservation has lapsed by the time anyone looks, which only
  // means it no longer holds stock. Created now, not back-dated, because the unpaid-order job
  // cancels checkouts 24 hours old; if it did, a re-run puts a fresh one in its place.
  if (maizeId) {
    const placed = await prisma.order.findMany({ where: { lotId: maizeId, buyerUserId: ids.buyerTwoId } });
    if (placed.every((o) => o.status === "CANCELLED" && o.cancelReason === "PAYMENT_EXPIRED")) {
      await checkout(buyer2, maizeId, 10, T);
    }
  }

  // Paid, payment held until delivery is confirmed.
  let lotId = await missing("rice", buyer1);
  if (lotId) await pay(await checkout(buyer1, lotId, 10, ago(2)), ago(2, 10));

  // Preparing, with a delivery date.
  lotId = await missing("rice", buyer2);
  if (lotId) {
    const orderId = await checkout(buyer2, lotId, 8, ago(3));
    await pay(orderId, ago(3, 10));
    await orders.startPreparing(officer, orderId, ago(2, 30));
    await orders.setDeliveryDate(officer, orderId, addDays(lagosDateKey(T), 2), ago(2, 31));
  }

  // Delivered, waiting for the buyer: marked a day ago, well inside the 72 hours to auto-release.
  lotId = await missing("soybeans", buyer1);
  if (lotId) {
    const orderId = await checkout(buyer1, lotId, 12, ago(4));
    await pay(orderId, ago(4, 10));
    await orders.markDelivered(officer, orderId, 12, ago(1));
  }

  // Completed: delivered, confirmed by the buyer, and both payouts sent through the fake Paystack.
  lotId = await missing("soybeans", buyer2);
  if (lotId) {
    const orderId = await checkout(buyer2, lotId, 15, ago(9));
    await pay(orderId, ago(9, 10));
    await orders.markDelivered(officer, orderId, 15, ago(6));
    await orders.confirmReceipt(buyer2, orderId, ago(5));
  }

  // Refunded: the buyer cancelled the paid order and the refund was settled.
  lotId = await missing("sorghum", buyer1);
  if (lotId) {
    const orderId = await checkout(buyer1, lotId, 10, ago(6));
    await pay(orderId, ago(6, 10));
    await orders.cancelOrder(buyer1, orderId, "Changed my plans", ago(6, 60));
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    await payments.settleRefund({ refundId: refund.paystackRefundId ?? undefined }, "PROCESSED", ago(6, 90));
  }

  // In dispute: delivered, then reported by the buyer; the money stays held for an admin.
  lotId = await missing("sorghum", buyer2);
  if (lotId) {
    const orderId = await checkout(buyer2, lotId, 12, ago(3));
    await pay(orderId, ago(3, 10));
    await orders.markDelivered(officer, orderId, 12, ago(2));
    await orders.reportProblem(buyer2, orderId, "Some of the bags arrived damp and torn.", ago(1, 5));
  }
}

async function main(argv: string[]): Promise<number> {
  const allowRemote = argv.includes("--allow-remote");
  const databaseUrl = process.env.DATABASE_URL || LOCAL_DEV_DATABASE_URL;
  const target = checkSeedTarget({ databaseUrl, appEnv: process.env.APP_ENV, allowRemote });
  if (!target.ok) {
    console.error(
      `Refusing to seed database "${target.database}" on host ${target.host}: ${target.reason}.`,
    );
    return 1;
  }
  console.log(`Seeding database "${target.database}" on host ${target.host}.`);

  process.env.DATABASE_URL = databaseUrl;
  // The seed only writes rows. APP_ENV=local keeps every adapter on its fake, so sign-up's
  // verification emails go to the in-memory outbox and nothing external is called.
  process.env.APP_ENV = "local";
  delete process.env.RESEND_API_KEY;
  delete process.env.PAYSTACK_SECRET_KEY;
  process.env.BETTER_AUTH_SECRET ||= "unused-by-seed-0123456789abcdef0123456789";
  process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
  process.env.CRON_SECRET ||= "unused-by-seed";

  const { prisma } = await import("@/lib/db");
  try {
    const { password, created } = await seed();
    if (password) {
      console.log(`Created ${created.join(", ")}.`);
      console.log(`Password for the new users (shown once; local use only): ${password}`);
    } else {
      console.log("Seed data already present; nothing created and no password changed.");
    }
    console.log(
      `Admin ${SEED.admin.email} and board admin ${SEED.board.email} (each enrols ` +
        `two-factor on their first admin page), officer ${SEED.officer.email}, pending ` +
        `farmer ${SEED.farmer.email}.`,
    );
    return 0;
  } catch (error) {
    // Name and code only: a database error message can carry the connection URL.
    const code = (error as { code?: unknown }).code;
    console.error(`Seed failed: ${error instanceof Error ? error.name : "non-Error thrown"}${code ? ` (${String(code)})` : ""}.`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
