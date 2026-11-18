// Pure: whether a nav link points at the page being shown (itself or a page under it).
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Pure: the link that is the current page, the longest one matching, so a page under
// /farmer/lots lights "My lots" and not "My farm" (/farmer) as well. Null when none match.
export function currentHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (isCurrent(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

// Pure: whether a bar item is current: the link itself, or a group holding the current page.
// allHrefs is every link in the bar, so the longest match is taken across all of them.
export function itemIsCurrent(
  item: { kind: "link"; href: string } | { kind: "group"; links: Array<{ href: string }> },
  pathname: string,
  allHrefs: string[],
): boolean {
  const current = currentHref(pathname, allHrefs);
  if (current === null) return false;
  return item.kind === "link" ? item.href === current : item.links.some((l) => l.href === current);
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

// Pure: whether the bar hands its right side (Sign in, or the alerts bell and the account avatar)
// to the round menu. While the bar is shrunk on a phone it has room for the logo and the menu
// button only; the CSS limits this to below the nav breakpoint. With no menu button there is
// nowhere to hand them to, so they stay.
export function accountInMenu({ compact, hasMenu }: { compact: boolean; hasMenu: boolean }): boolean {
  return compact && hasMenu;
}

// Pure: what the phone menu offers for the account, by copy key. Signed out: Sign in, at the top.
// Signed in: Alerts and Profile at the top and Sign out at the end, the things the avatar and
// the bell give in the bar.
// Alerts only where the bell is: someone with no role yet has none, and /alerts would send them away.
export function menuAccountEntries({ signedIn, hasAlerts }: { signedIn: boolean; hasAlerts: boolean }): {
  top: Array<"signIn" | "alerts" | "profile">;
  bottom: Array<"signOut">;
} {
  if (!signedIn) return { top: ["signIn"], bottom: [] };
  return { top: hasAlerts ? ["alerts", "profile"] : ["profile"], bottom: ["signOut"] };
}
