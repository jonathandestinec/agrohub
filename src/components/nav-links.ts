import type { Role } from "@/modules/identity/policies";

export type NavLabelKey = "cooperative" | "invites" | "farmers" | "reviewCooperatives" | "farm";
export type NavLink = { href: string; labelKey: NavLabelKey };

const LINKS: Partial<Record<Role, NavLink[]>> = {
  OFFICER: [
    { href: "/officer/onboarding", labelKey: "cooperative" },
    { href: "/officer/invites", labelKey: "invites" },
    { href: "/officer/farmers", labelKey: "farmers" },
  ],
  ADMIN: [{ href: "/admin/cooperatives", labelKey: "reviewCooperatives" }],
  FARMER: [{ href: "/farmer", labelKey: "farm" }],
};

// Pure: the header links for the active role. Convenience only: every page checks access itself.
export function navLinksFor(role: Role | null): NavLink[] {
  return role ? (LINKS[role] ?? []) : [];
}
