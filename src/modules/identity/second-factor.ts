import { ForbiddenError } from "@/lib/errors";
import type { Role } from "@/modules/identity/policies";

const ROLES_REQUIRING_SECOND_FACTOR: ReadonlySet<Role> = new Set(["ADMIN", "BOARD_ADMIN"]);

// Pure guard. It is not wired into routes yet: deriving twoFactorVerified from a live Better Auth session waits for the first admin route in Phase 1.
export function requireSecondFactor(session: { role: Role; twoFactorVerified: boolean }): void {
  if (ROLES_REQUIRING_SECOND_FACTOR.has(session.role) && !session.twoFactorVerified) {
    throw new ForbiddenError("2FA_REQUIRED");
  }
}
