import type { Membership } from "./service";
import type { Role } from "./policies";

const PRIORITY: readonly Role[] = [
  "ADMIN",
  "BOARD_ADMIN",
  "OFFICER",
  "FARMER",
  "BUYER",
];

// Pure: picks which membership is active. The preferred id wins when it is in
// the list; otherwise the highest-priority role; otherwise null.
export function pickActiveMembership(
  memberships: Membership[],
  preferredId?: string,
): Membership | null {
  if (preferredId !== undefined) {
    const preferred = memberships.find((m) => m.id === preferredId);
    if (preferred) return preferred;
  }
  for (const role of PRIORITY) {
    const found = memberships.find((m) => m.role === role);
    if (found) return found;
  }
  return null;
}
