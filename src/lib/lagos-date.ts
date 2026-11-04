// Calendar dates in Lagos (UTC+1, no daylight saving), as "YYYY-MM-DD" keys. Lot dates such
// as available-until are Lagos calendar days stored in @db.Date columns (midnight UTC).

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Lagos calendar date of an instant. */
export function lagosDateKey(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** True for a real calendar date written "YYYY-MM-DD". */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A date key as midnight UTC of that date, the value a @db.Date column holds. */
export function lagosDate(key: string): Date {
  if (!isDateKey(key)) throw new RangeError(`Invalid date: ${JSON.stringify(key)}`);
  return new Date(`${key}T00:00:00Z`);
}

/** The date key `days` whole days after (or before) `key`. */
export function addDays(key: string, days: number): string {
  return new Date(lagosDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** An instant as Lagos wall-clock time for text a person reads: "5 Nov 2026, 13:00 Lagos time". */
export function formatLagosDateTime(at: Date): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(at);
  return `${text} Lagos time`;
}
