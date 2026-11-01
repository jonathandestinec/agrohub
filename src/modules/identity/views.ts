import type { Role } from "./policies";
import type { Membership } from "./service";

export type SwitcherMembership = {
  id: string;
  role: Role;
  cooperativeId: string | null;
};

// The only shape of a membership that may reach client components.
export function toSwitcherMembership(m: Membership): SwitcherMembership {
  return { id: m.id, role: m.role, cooperativeId: m.cooperativeId };
}
