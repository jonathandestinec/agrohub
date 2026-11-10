import type { Role } from "./policies";
import type { Membership, OwnProfile } from "./service";

export type SwitcherMembership = {
  id: string;
  role: Role;
  cooperativeId: string | null;
};

// The only shape of a membership that may reach client components.
export function toSwitcherMembership(m: Membership): SwitcherMembership {
  return { id: m.id, role: m.role, cooperativeId: m.cooperativeId };
}

export type OwnProfileView = {
  name: string;
  email: string;
  phone: string | null;
  memberships: Array<{ role: Role; status: "ACTIVE" | "PENDING"; cooperativeName: string | null }>;
};

// The profile page's shape. The phone number is the person's own and reaches the page only
// here; no ids go out.
export function toOwnProfileView(profile: OwnProfile): OwnProfileView {
  return {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    memberships: profile.memberships.map((m) => ({
      role: m.role,
      status: m.status === "PENDING" ? "PENDING" : "ACTIVE",
      cooperativeName: m.cooperativeName,
    })),
  };
}
