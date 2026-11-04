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

// Pure: from which width the full bar fits (below it the round menu holds the links), or
// "menu" when it never does. The bar is at most 1304px wide: up to five links fit from lg, or
// from xl beside the role switcher (as wide as three links); six links fit from xl alone and
// never beside the switcher.
export function navBreakpoint(linkCount: number, hasSwitcher: boolean): "lg" | "xl" | "menu" {
  const crowded = linkCount > 5;
  if (crowded && hasSwitcher) return "menu";
  return crowded || hasSwitcher ? "xl" : "lg";
}
