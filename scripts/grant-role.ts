// Admin bootstrap: grants ADMIN or BOARD_ADMIN to an existing user.
//   DATABASE_URL=<url> npm run admin:grant -- <email> <ADMIN|BOARD_ADMIN>
// tsx never loads .env, so DATABASE_URL is always passed inline (docs/environments.md).
import { pathToFileURL } from "node:url";
import type { Membership } from "@/generated/prisma/client";

export type GrantableRole = "ADMIN" | "BOARD_ADMIN";

const GRANTABLE: readonly GrantableRole[] = ["ADMIN", "BOARD_ADMIN"];

// App modules are imported lazily: src/lib/env.ts validates eagerly on import, and the
// CLI below has to fill the variables this script never uses before that happens.
export async function grantRole(input: {
  email: string;
  role: GrantableRole;
}): Promise<Membership> {
  const [{ prisma }, { NotFoundError }, { addMembership }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/errors"),
    import("@/modules/identity/service"),
  ]);
  const user = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) throw new NotFoundError("USER_NOT_FOUND");
  return addMembership({ userId: user.id, role: input.role });
}

function isGrantableRole(value: string | undefined): value is GrantableRole {
  return GRANTABLE.includes(value as GrantableRole);
}

async function main(argv: string[]): Promise<number> {
  const [email, role] = argv;
  if (!email || !isGrantableRole(role)) {
    console.error("Usage: npm run admin:grant -- <email> <ADMIN|BOARD_ADMIN>");
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set inline; this script never reads .env.");
    return 1;
  }
  // Required by src/lib/env.ts but unused here: this script never signs, calls auth or runs cron.
  for (const name of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "CRON_SECRET"]) {
    process.env[name] ||= "unused-by-admin-grant";
  }
  const { prisma } = await import("@/lib/db");
  try {
    const membership = await grantRole({ email, role });
    console.log(`Granted ${membership.role} to ${email} (membership ${membership.id}).`);
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    console.error(
      code === "USER_NOT_FOUND"
        ? `No user with email ${email}. They must sign up first.`
        : `Could not grant ${role}: ${error instanceof Error ? error.message : String(error)}`,
    );
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
