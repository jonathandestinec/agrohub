// Addresses on domains reserved by RFC 2606 / RFC 6761 can never be delivered. Seeded demo
// accounts use them, so the real transport skips them instead of sending and bouncing.
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
const RESERVED_TLDS = ["test", "example", "invalid", "localhost"];

export function isReservedDomain(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  const domain = address.slice(at + 1).trim().toLowerCase();
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return RESERVED_TLDS.some((tld) => domain === tld || domain.endsWith(`.${tld}`));
}
