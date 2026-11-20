// A dashboard refreshes when its tab comes back into view, but not more than once per `minGapMs`:
// a refresh runs every tile's queries (7 to 18 or more), and tab switching can be rapid.
export function shouldRefreshOnFocus(lastRefreshAt: number, now: number, minGapMs: number): boolean {
  return now - lastRefreshAt >= minGapMs;
}
