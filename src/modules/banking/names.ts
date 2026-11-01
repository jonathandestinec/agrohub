// Legal and descriptive words that banks abbreviate, reorder or drop from account names.
const IGNORED = new Set([
  "LTD",
  "LIMITED",
  "COOPERATIVE",
  "SOCIETY",
  "MULTIPURPOSE",
  "NIG",
]);

function tokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !IGNORED.has(token));
}

// True when every meaningful registered token appears, as a whole token, in the name the
// bank resolved. A registered name with no meaningful tokens never matches.
export function namesMatch(registered: string, resolved: string): boolean {
  const wanted = tokens(registered);
  if (wanted.length === 0) return false;
  const have = new Set(tokens(resolved));
  return wanted.every((token) => have.has(token));
}
