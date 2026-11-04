import type { Prisma } from "@/generated/prisma/client";

// Name changes and bank changes for one subject exclude each other. Each check-then-write
// takes this transaction-scoped Postgres advisory lock first, so the check and the write
// cannot interleave with the other kind. A person is keyed by their user id (their farmer
// payout account belongs to them), a cooperative by its id.
export type NameSubject = { type: "USER" | "COOPERATIVE"; id: string };

export async function lockNameSubject(
  tx: Prisma.TransactionClient,
  subject: NameSubject,
): Promise<void> {
  const key = `name-subject:${subject.type}:${subject.id}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
