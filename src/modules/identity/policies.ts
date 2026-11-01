import type { Role as PrismaRole } from "@/generated/prisma/client";

export type Role = "FARMER" | "OFFICER" | "BUYER" | "ADMIN" | "BOARD_ADMIN";

// Compile-time check: fails to build if this union drifts from the Prisma enum.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _roleMatchesPrisma: Equals<Role, PrismaRole> = true;
void _roleMatchesPrisma;

export type Actor = {
  userId: string;
  role: Role;
  cooperativeId: string | null;
  twoFactorEnabled: boolean;
};

export type Action =
  | "cooperative:verify"
  | "cooperative:suspend"
  | "cooperative:queue"
  | "price:write"
  | "farmer:approve"
  | "lot:approve"
  | "dispute:resolve"
  | "cooperative:read"
  | "cooperative:upload"
  | "document:view";

export type Resource = {
  cooperativeId?: string;
  ownerUserId?: string;
  cooperativeHasOtherOfficer?: boolean;
};

function isOwnCooperative(
  actor: Actor,
  resource: Resource | undefined,
): boolean {
  return (
    actor.cooperativeId !== null &&
    actor.cooperativeId === resource?.cooperativeId
  );
}

// Pure and deny by default: one rule per action; missing resource fields yield false.
export function can(
  actor: Actor,
  action: Action,
  resource?: Resource,
): boolean {
  switch (action) {
    case "cooperative:verify":
    case "cooperative:suspend":
    case "cooperative:queue":
    case "dispute:resolve":
      return actor.role === "ADMIN";
    case "price:write":
      return actor.role === "BOARD_ADMIN";
    case "farmer:approve":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    case "lot:approve":
      if (actor.role === "OFFICER") {
        return (
          isOwnCooperative(actor, resource) &&
          resource?.ownerUserId !== undefined &&
          resource.ownerUserId !== actor.userId
        );
      }
      if (actor.role === "ADMIN") {
        return (
          resource?.cooperativeHasOtherOfficer === false &&
          resource.ownerUserId !== undefined &&
          resource.ownerUserId !== actor.userId
        );
      }
      return false;
    case "cooperative:read":
    case "document:view":
      return (
        actor.role === "ADMIN" ||
        (actor.role === "OFFICER" && isOwnCooperative(actor, resource))
      );
    case "cooperative:upload":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    default:
      return false;
  }
}
