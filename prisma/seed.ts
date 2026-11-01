// Demo data for local and staging:
//   npm run db:seed                                   (local Docker database)
//   DATABASE_URL=<url> npm run db:seed -- --allow-remote   (staging; never production)
// Creates one admin (two-factor off, so /two-factor enrolment shows), one VERIFIED
// cooperative with an ACTIVE officer, and one PENDING farmer with a profile. Re-running
// it adds nothing. tsx never loads .env, so the database is DATABASE_URL or local Docker.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { SignUpEmailBody } from "@/lib/auth";

// The same default as prisma.config.ts: with nothing set, only the local dev database.
const LOCAL_DEV_DATABASE_URL = "postgresql://agrohub:agrohub@localhost:5432/agrohub";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const SEED = {
  admin: { name: "Seed Admin", email: "seed-admin@example.com" },
  officer: { name: "Seed Officer", email: "seed-officer@example.com" },
  farmer: { name: "Seed Farmer", email: "seed-farmer@example.com" },
  phone: "+2348000000000",
  cooperative: {
    name: "Seed Demo Farmers Cooperative",
    registrationNumber: "RC-SEED-0001",
    state: "Kaduna",
    lga: "Zaria",
    certificateExpiresAt: new Date("2030-12-31T00:00:00Z"),
  },
  profile: { farmSizeHectares: "2.50", crops: ["Maize", "Sorghum"], state: "Kaduna", lga: "Zaria" },
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
  } catch {
    return { ok: false, host, database, reason: "DATABASE_URL is not a valid URL" };
  }
  if (input.appEnv === "production") {
    return { ok: false, host, database, reason: "APP_ENV is production; the seed never runs there" };
  }
  if (!LOCAL_HOSTS.has(host) && !input.allowRemote) {
    return {
      ok: false,
      host,
      database,
      reason: "the host is not localhost; pass --allow-remote to seed staging",
    };
  }
  return { ok: true, host, database };
}

// App modules are imported lazily: src/lib/env.ts validates on import, and the CLI below
// sets its variables first. Returns the password when it created any user, else null.
export async function seed(): Promise<{ password: string | null; created: string[] }> {
  const [{ prisma }, { auth }, { addMembership }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/auth"),
    import("@/modules/identity/service"),
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
    role: "ADMIN" | "OFFICER" | "FARMER";
    cooperativeId?: string;
    status: "ACTIVE" | "PENDING";
  }): Promise<void> {
    const existing = await prisma.membership.findFirst({
      where: { userId: input.userId, role: input.role, cooperativeId: input.cooperativeId ?? null },
    });
    if (!existing) await addMembership(input);
  }

  const adminId = await ensureUser(SEED.admin);
  const officerId = await ensureUser(SEED.officer);
  const farmerId = await ensureUser(SEED.farmer);

  const now = new Date();
  const cooperative = await prisma.cooperative.upsert({
    where: { registrationNumber: SEED.cooperative.registrationNumber },
    create: { ...SEED.cooperative, status: "VERIFIED", submittedAt: now, verifiedAt: now },
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
      crops: [...SEED.profile.crops],
      state: SEED.profile.state,
      lga: SEED.profile.lga,
    },
    update: {},
  });

  return { password: created.length > 0 ? password : null, created };
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
      `Admin ${SEED.admin.email} (enrols two-factor on first admin page), officer ` +
        `${SEED.officer.email}, pending farmer ${SEED.farmer.email}.`,
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
