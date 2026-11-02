// Pure: whether a nav link points at the page being shown (itself or a page under it).
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
