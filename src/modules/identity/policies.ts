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
  | "farmer:remove"
  | "farmer:leave"
  | "lot:approve"
  | "dispute:resolve"
  | "cooperative:read"
  | "cooperative:upload"
  | "cooperative:edit"
  | "document:view"
  | "bank:change"
  | "invite:manage"
  | "catalog:manage"
  | "setting:write"
  | "farmer:profile"
  | "catalog:request"
  | "catalog:forward"
  | "lot:submit"
  | "lot:own"
  | "lot:screen";

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
    case "setting:write":
      return actor.role === "ADMIN";
    case "price:write":
    case "catalog:manage":
      return actor.role === "BOARD_ADMIN";
    case "farmer:approve":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    case "farmer:remove":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    case "farmer:leave":
    case "farmer:profile":
      // A farmer leaves, or edits, only their own membership and profile.
      return (
        actor.role === "FARMER" &&
        resource?.ownerUserId !== undefined &&
        resource.ownerUserId === actor.userId
      );
    case "lot:screen":
      // Who may see a screening queue; each decision still checks lot:approve on the lot.
      return actor.role === "ADMIN" || (actor.role === "OFFICER" && isOwnCooperative(actor, resource));
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
    case "cooperative:edit":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    case "bank:change":
      // Farmers change their own account through the self-scoped banking function.
      return (
        actor.role === "OFFICER" &&
        actor.twoFactorEnabled &&
        isOwnCooperative(actor, resource)
      );
    case "invite:manage":
    case "catalog:forward":
      return actor.role === "OFFICER" && isOwnCooperative(actor, resource);
    case "catalog:request":
    case "lot:submit":
      return actor.role === "FARMER" && isOwnCooperative(actor, resource);
    case "lot:own":
      // The farmer who submitted the lot, while still in that cooperative.
      return (
        actor.role === "FARMER" &&
        isOwnCooperative(actor, resource) &&
        resource?.ownerUserId !== undefined &&
        resource.ownerUserId === actor.userId
      );
    default:
      return false;
  }
}
