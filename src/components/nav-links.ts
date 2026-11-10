import type { MembershipStatus } from "@/generated/prisma/client";
import type { Role } from "@/modules/identity/policies";

export type NavLabelKey =
  | "cooperative"
  | "invites"
  | "farmers"
  | "reviewCooperatives"
  | "adminCooperatives"
  | "farm"
  | "registerCooperative"
  | "yourFarm"
  | "prices"
  | "priceEntry"
  | "cropsUnits"
  | "platformSettings"
  | "myLots"
  | "screenLots"
  | "lotQueue"
  | "browseLots"
  | "myOffers"
  | "buyProduce"
  | "messages"
  | "offers"
  | "orders"
  | "myOrders"
  | "nameChanges"
  | "payouts"
  | "orderQueue"
  | "earnings";

// Names of the dropdown groups in the bar.
export type NavGroupKey =
  | "groupReview"
  | "groupOrders"
  | "groupMore"
  | "groupCooperative"
  | "groupSelling"
  | "groupBuying";

export type NavLink = { href: string; labelKey: NavLabelKey };
// One item in the bar: a plain link, or a labelled group that opens a dropdown of links.
export type NavItem =
  | { kind: "link"; href: string; labelKey: NavLabelKey }
  | { kind: "group"; labelKey: NavGroupKey; links: NavLink[] };

const link = (href: string, labelKey: NavLabelKey): NavItem => ({ kind: "link", href, labelKey });
const group = (labelKey: NavGroupKey, links: Array<[string, NavLabelKey]>): NavItem => ({
  kind: "group",
  labelKey,
  links: links.map(([href, key]) => ({ href, labelKey: key })),
});

// At most three items a role, so the bar stays clear. Every list or queue page a role can
// open is in here, either as an item or inside a group.
const ITEMS: Partial<Record<Role, NavItem[]>> = {
  ADMIN: [
    group("groupReview", [
      ["/admin/cooperatives", "adminCooperatives"],
      ["/admin/names", "nameChanges"],
      ["/admin/lots", "lotQueue"],
    ]),
    group("groupOrders", [
      ["/admin/orders", "orderQueue"],
      ["/admin/payouts", "payouts"],
    ]),
    group("groupMore", [
      ["/messages", "messages"],
      ["/admin/settings", "platformSettings"],
    ]),
  ],
  OFFICER: [
    group("groupCooperative", [
      ["/officer/onboarding", "cooperative"],
      ["/officer/farmers", "farmers"],
      ["/officer/invites", "invites"],
    ]),
    group("groupSelling", [
      ["/officer/lots", "screenLots"],
      ["/officer/offers", "offers"],
      ["/officer/orders", "orders"],
      ["/prices", "prices"],
    ]),
    link("/messages", "messages"),
  ],
  FARMER: [
    link("/farmer", "farm"),
    group("groupSelling", [
      ["/farmer/lots", "myLots"],
      ["/farmer/earnings", "earnings"],
    ]),
    group("groupMore", [
      ["/messages", "messages"],
      ["/prices", "prices"],
    ]),
  ],
  BUYER: [
    link("/lots", "browseLots"),
    group("groupBuying", [
      ["/buyer", "myOffers"],
      ["/buyer/orders", "myOrders"],
    ]),
    group("groupMore", [
      ["/messages", "messages"],
      ["/prices", "prices"],
    ]),
  ],
  BOARD_ADMIN: [link("/board", "priceEntry"), link("/board/crops", "cropsUnits"), link("/prices", "prices")],
};

// Pure: the bar items for the active role. Convenience only: every page checks access itself.
export function navItemsFor(role: Role | null): NavItem[] {
  return role ? (ITEMS[role] ?? []) : [];
}

// Pure: what a signed-out visitor is offered besides "Sign in".
export function navItemsSignedOut(): NavItem[] {
  return [link("/lots", "browseLots"), link("/prices", "prices")];
}

// Pure: every link in the items, groups opened out, in bar order.
export function flattenNav(items: NavItem[]): NavLink[] {
  return items.flatMap((item) =>
    item.kind === "link" ? [{ href: item.href, labelKey: item.labelKey }] : item.links,
  );
}

// Pure: the same links as a flat list, for the active role.
export function navLinksFor(role: Role | null): NavLink[] {
  return flattenNav(navItemsFor(role));
}

// Pure: the bar items for a signed-in user with no ACTIVE membership. A farmer waiting
// for approval gets their farm page; a user with no officer or farmer membership at all
// (in any status) is offered to register a cooperative or to start buying.
export function navLinksWithoutActiveMembership(
  memberships: Array<{ role: Role; status: MembershipStatus }>,
): NavLink[] {
  if (memberships.some((m) => m.role === "FARMER" && m.status === "PENDING")) {
    return [{ href: "/farmer", labelKey: "yourFarm" }];
  }
  if (!memberships.some((m) => m.role === "OFFICER" || m.role === "FARMER")) {
    return [
      { href: "/officer/onboarding", labelKey: "registerCooperative" },
      { href: "/buyer/join", labelKey: "buyProduce" },
    ];
  }
  return [];
}
