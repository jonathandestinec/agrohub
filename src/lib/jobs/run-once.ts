import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Runs fn at most once per key, even across concurrent or repeated calls.
 *
 * The JobRun row is inserted first and the unique key decides the winner: a
 * P2002 violation means someone else already claimed the key, so we skip
 * without calling fn. If fn throws we delete the row so a later call can retry
 * (otherwise a failed run would block that key forever) and rethrow. Any
 * other database error propagates; it is never mistaken for "already ran".
 */
export async function runOnce(
  key: string,
  fn: () => Promise<void>,
): Promise<"ran" | "skipped"> {
  try {
    await prisma.jobRun.create({ data: { key } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return "skipped";
    }
    throw error;
  }

  try {
    await fn();
  } catch (error) {
    await prisma.jobRun.deleteMany({ where: { key } });
    throw error;
  }
  return "ran";
}
