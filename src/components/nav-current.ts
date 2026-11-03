// Pure: whether a nav link points at the page being shown (itself or a page under it).
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Pure: whether the nav links sit centred in the bar. One or two look stranded there, so
// they join the account action on the right; three or more fill the centre.
export function centreNavLinks(count: number): boolean {
  return count > 2;
}

// Pure: whether the header carries the role switcher. One membership has nothing to switch to.
export function showRoleSwitcher(membershipCount: number): boolean {
  return membershipCount > 1;
}
