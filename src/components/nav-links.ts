import type { MembershipStatus } from "@/generated/prisma/client";
import type { Role } from "@/modules/identity/policies";

export type NavLabelKey =
  | "cooperative"
  | "invites"
  | "farmers"
  | "reviewCooperatives"
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
export type NavLink = { href: string; labelKey: NavLabelKey };

const LINKS: Partial<Record<Role, NavLink[]>> = {
  OFFICER: [
    { href: "/officer/onboarding", labelKey: "cooperative" },
    { href: "/officer/invites", labelKey: "invites" },
    { href: "/officer/farmers", labelKey: "farmers" },
    { href: "/officer/lots", labelKey: "screenLots" },
    { href: "/officer/offers", labelKey: "offers" },
    { href: "/officer/orders", labelKey: "orders" },
    { href: "/messages", labelKey: "messages" },
  ],
  ADMIN: [
    { href: "/admin/cooperatives", labelKey: "reviewCooperatives" },
    { href: "/admin/names", labelKey: "nameChanges" },
    { href: "/admin/lots", labelKey: "lotQueue" },
    { href: "/admin/settings", labelKey: "platformSettings" },
    { href: "/admin/orders", labelKey: "orderQueue" },
    { href: "/admin/payouts", labelKey: "payouts" },
  ],
  FARMER: [
    { href: "/farmer", labelKey: "farm" },
    { href: "/farmer/lots", labelKey: "myLots" },
    { href: "/farmer/earnings", labelKey: "earnings" },
    { href: "/messages", labelKey: "messages" },
    { href: "/prices", labelKey: "prices" },
  ],
  BUYER: [
    { href: "/lots", labelKey: "browseLots" },
    { href: "/buyer", labelKey: "myOffers" },
    { href: "/buyer/orders", labelKey: "myOrders" },
    { href: "/messages", labelKey: "messages" },
  ],
  BOARD_ADMIN: [
    { href: "/board", labelKey: "priceEntry" },
    { href: "/board/crops", labelKey: "cropsUnits" },
    { href: "/prices", labelKey: "prices" },
  ],
};

// Pure: the header links for the active role. Convenience only: every page checks access itself.
export function navLinksFor(role: Role | null): NavLink[] {
  return role ? (LINKS[role] ?? []) : [];
}

// Pure: the header links for a signed-in user with no ACTIVE membership. A farmer waiting
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
