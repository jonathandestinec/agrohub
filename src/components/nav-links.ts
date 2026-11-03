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
  | "prices";
export type NavLink = { href: string; labelKey: NavLabelKey };

const LINKS: Partial<Record<Role, NavLink[]>> = {
  OFFICER: [
    { href: "/officer/onboarding", labelKey: "cooperative" },
    { href: "/officer/invites", labelKey: "invites" },
    { href: "/officer/farmers", labelKey: "farmers" },
  ],
  ADMIN: [{ href: "/admin/cooperatives", labelKey: "reviewCooperatives" }],
  FARMER: [
    { href: "/farmer", labelKey: "farm" },
    { href: "/prices", labelKey: "prices" },
  ],
};

// Pure: the header links for the active role. Convenience only: every page checks access itself.
export function navLinksFor(role: Role | null): NavLink[] {
  return role ? (LINKS[role] ?? []) : [];
}

// Pure: the header links for a signed-in user with no ACTIVE membership. A farmer waiting
// for approval gets their farm page; a user with no officer or farmer membership at all
// (in any status) is offered to register a cooperative.
export function navLinksWithoutActiveMembership(
  memberships: Array<{ role: Role; status: MembershipStatus }>,
): NavLink[] {
  if (memberships.some((m) => m.role === "FARMER" && m.status === "PENDING")) {
    return [{ href: "/farmer", labelKey: "yourFarm" }];
  }
  if (!memberships.some((m) => m.role === "OFFICER" || m.role === "FARMER")) {
    return [{ href: "/officer/onboarding", labelKey: "registerCooperative" }];
  }
  return [];
}
