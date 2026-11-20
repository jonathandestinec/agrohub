import pg from "pg";
import { vi } from "vitest";

// Runs fn and returns how many SQL statements it sent. Every Prisma query goes
// through a pg Client (pooled or not), so counting Client#query counts them all.
export async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    const result = await fn();
    return { result, queries: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}
