// Board weeks run Monday to Sunday in Lagos time. Nigeria is UTC+1 all year (no daylight
// saving), so a fixed offset is exact.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday of the Lagos week containing `at`, as a UTC-midnight date. */
export function weekStart(at: Date): Date {
  const lagos = new Date(at.getTime() + LAGOS_OFFSET_MS);
  const midnight = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate());
  const daysSinceMonday = (lagos.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

/** "YYYY-MM-DD" of a UTC-midnight date. */
export function toWeekKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" of the Monday of the Lagos week containing `now`. */
export function currentWeekKey(now: Date): string {
  return toWeekKey(weekStart(now));
}
