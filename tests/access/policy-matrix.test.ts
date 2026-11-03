import { describe, expect, it } from "vitest";
import {
  can,
  type Action,
  type Actor,
  type Role,
} from "@/modules/identity/policies";

const COOP = "coop-1";
const OTHER_COOP = "coop-2";

// twoFactorEnabled is true so the matrix shows each role's best case; only
// bank:change reads it, and its denial without two-factor is tested below.
function actor(role: Role, cooperativeId: string | null = null): Actor {
  return { userId: "user-1", role, cooperativeId, twoFactorEnabled: true };
}

// Every action by every role, with a resource that satisfies the scope rules
// (the actor's own cooperative; a different owner for lot approval).
const own = { cooperativeId: COOP, ownerUserId: "farmer-9" };

const matrix: Array<[Action, Role, boolean]> = [
  ["cooperative:verify", "FARMER", false],
  ["cooperative:verify", "OFFICER", false],
  ["cooperative:verify", "BUYER", false],
  ["cooperative:verify", "ADMIN", true],
  ["cooperative:verify", "BOARD_ADMIN", false],

  ["cooperative:suspend", "FARMER", false],
  ["cooperative:suspend", "OFFICER", false],
  ["cooperative:suspend", "BUYER", false],
  ["cooperative:suspend", "ADMIN", true],
  ["cooperative:suspend", "BOARD_ADMIN", false],

  ["cooperative:queue", "FARMER", false],
  ["cooperative:queue", "OFFICER", false],
  ["cooperative:queue", "BUYER", false],
  ["cooperative:queue", "ADMIN", true],
  ["cooperative:queue", "BOARD_ADMIN", false],

  ["dispute:resolve", "FARMER", false],
  ["dispute:resolve", "OFFICER", false],
  ["dispute:resolve", "BUYER", false],
  ["dispute:resolve", "ADMIN", true],
  ["dispute:resolve", "BOARD_ADMIN", false],

  ["price:write", "FARMER", false],
  ["price:write", "OFFICER", false],
  ["price:write", "BUYER", false],
  ["price:write", "ADMIN", false],
  ["price:write", "BOARD_ADMIN", true],

  ["farmer:approve", "FARMER", false],
  ["farmer:approve", "OFFICER", true],
  ["farmer:approve", "BUYER", false],
  ["farmer:approve", "ADMIN", false],
  ["farmer:approve", "BOARD_ADMIN", false],

  // lot:approve with no cooperativeHasOtherOfficer flag: ADMIN is denied.
  ["lot:approve", "FARMER", false],
  ["lot:approve", "OFFICER", true],
  ["lot:approve", "BUYER", false],
  ["lot:approve", "ADMIN", false],
  ["lot:approve", "BOARD_ADMIN", false],

  ["cooperative:read", "FARMER", false],
  ["cooperative:read", "OFFICER", true],
  ["cooperative:read", "BUYER", false],
  ["cooperative:read", "ADMIN", true],
  ["cooperative:read", "BOARD_ADMIN", false],

  ["cooperative:upload", "FARMER", false],
  ["cooperative:upload", "OFFICER", true],
  ["cooperative:upload", "BUYER", false],
  ["cooperative:upload", "ADMIN", false],
  ["cooperative:upload", "BOARD_ADMIN", false],

  ["cooperative:edit", "FARMER", false],
  ["cooperative:edit", "OFFICER", true],
  ["cooperative:edit", "BUYER", false],
  ["cooperative:edit", "ADMIN", false],
  ["cooperative:edit", "BOARD_ADMIN", false],

  ["document:view", "FARMER", false],
  ["document:view", "OFFICER", true],
  ["document:view", "BUYER", false],
  ["document:view", "ADMIN", true],
  ["document:view", "BOARD_ADMIN", false],

  ["bank:change", "FARMER", false],
  ["bank:change", "OFFICER", true],
  ["bank:change", "BUYER", false],
  ["bank:change", "ADMIN", false],
  ["bank:change", "BOARD_ADMIN", false],

  ["invite:manage", "FARMER", false],
  ["invite:manage", "OFFICER", true],
  ["invite:manage", "BUYER", false],
  ["invite:manage", "ADMIN", false],
  ["invite:manage", "BOARD_ADMIN", false],

  ["farmer:remove", "FARMER", false],
  ["farmer:remove", "OFFICER", true],
  ["farmer:remove", "BUYER", false],
  ["farmer:remove", "ADMIN", false],
  ["farmer:remove", "BOARD_ADMIN", false],

  // farmer:leave is checked against a resource the actor owns (see below).
  ["farmer:leave", "FARMER", true],
  ["farmer:leave", "OFFICER", false],
  ["farmer:leave", "BUYER", false],
  ["farmer:leave", "ADMIN", false],
  ["farmer:leave", "BOARD_ADMIN", false],

  ["catalog:manage", "FARMER", false],
  ["catalog:manage", "OFFICER", false],
  ["catalog:manage", "BUYER", false],
  ["catalog:manage", "ADMIN", false],
  ["catalog:manage", "BOARD_ADMIN", true],
];

describe("policy matrix", () => {
  it.each(matrix)("%s as %s -> %s", (action, role, expected) => {
    const cooperativeId = role === "OFFICER" || role === "FARMER" ? COOP : null;
    const resource =
      action === "farmer:leave" ? { ...own, ownerUserId: "user-1" } : own;
    expect(can(actor(role, cooperativeId), action, resource)).toBe(expected);
  });

  it("covers every action and role", () => {
    expect(matrix).toHaveLength(80);
  });
});

describe("farmer removal and leaving", () => {
  it("denies an officer of another cooperative farmer:remove", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "farmer:remove", own)).toBe(false);
  });

  it("denies farmer:remove with no resource or a null cooperativeId", () => {
    expect(can(actor("OFFICER", COOP), "farmer:remove")).toBe(false);
    expect(can(actor("OFFICER", null), "farmer:remove", {})).toBe(false);
  });

  it("lets a farmer leave only as the owner of the membership", () => {
    const farmer = actor("FARMER", COOP);
    expect(can(farmer, "farmer:leave", { ownerUserId: "user-1" })).toBe(true);
    expect(can(farmer, "farmer:leave", { ownerUserId: "farmer-9" })).toBe(false);
    expect(can(farmer, "farmer:leave")).toBe(false);
    expect(
      can(actor("OFFICER", COOP), "farmer:leave", { ownerUserId: "user-1" }),
    ).toBe(false);
  });
});

describe("cooperative scoping", () => {
  it("denies an officer of another cooperative cooperative:edit", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "cooperative:edit", own)).toBe(false);
    expect(can(actor("OFFICER", COOP), "cooperative:edit")).toBe(false);
  });

  it("denies an officer of another cooperative farmer:approve", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "farmer:approve", own)).toBe(
      false,
    );
  });

  it("denies an officer of another cooperative lot:approve", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "lot:approve", own)).toBe(false);
  });

  it("denies farmer:approve and lot:approve when the resource is missing", () => {
    const officer = actor("OFFICER", COOP);
    expect(can(officer, "farmer:approve")).toBe(false);
    expect(can(officer, "lot:approve")).toBe(false);
    expect(can(officer, "farmer:approve", {})).toBe(false);
    expect(can(officer, "lot:approve", { cooperativeId: COOP })).toBe(false);
    expect(can(officer, "lot:approve", { ownerUserId: "farmer-9" })).toBe(
      false,
    );
  });

  it("denies an officer with a null cooperativeId, even when the resource has none", () => {
    const officer = actor("OFFICER", null);
    expect(can(officer, "farmer:approve", {})).toBe(false);
    expect(can(officer, "lot:approve", { ownerUserId: "farmer-9" })).toBe(
      false,
    );
  });
});

describe("cooperative documents", () => {
  const actions = ["cooperative:read", "cooperative:upload", "document:view"] as const;

  it("denies an officer of another cooperative", () => {
    const other = actor("OFFICER", OTHER_COOP);
    for (const action of actions) {
      expect(can(other, action, { cooperativeId: COOP })).toBe(false);
    }
  });

  it("denies an officer with no resource or a null cooperativeId", () => {
    for (const action of actions) {
      expect(can(actor("OFFICER", COOP), action)).toBe(false);
      expect(can(actor("OFFICER", null), action, {})).toBe(false);
    }
  });

  it("lets an admin read and view any cooperative but never upload", () => {
    const admin = actor("ADMIN");
    const other = { cooperativeId: OTHER_COOP };
    expect(can(admin, "cooperative:read", other)).toBe(true);
    expect(can(admin, "document:view", other)).toBe(true);
    expect(can(admin, "cooperative:upload", other)).toBe(false);
  });
});

describe("lot approval", () => {
  it("officer_cannot_approve_own_lot", () => {
    const officer = actor("OFFICER", COOP);
    expect(
      can(officer, "lot:approve", {
        cooperativeId: COOP,
        ownerUserId: officer.userId,
      }),
    ).toBe(false);
  });

  it("admin_may_approve_when_no_other_officer", () => {
    const admin = actor("ADMIN");
    const base = { cooperativeId: COOP, ownerUserId: "farmer-9" };
    expect(
      can(admin, "lot:approve", { ...base, cooperativeHasOtherOfficer: false }),
    ).toBe(true);
    expect(
      can(admin, "lot:approve", { ...base, cooperativeHasOtherOfficer: true }),
    ).toBe(false);
    expect(
      can(admin, "lot:approve", {
        ...base,
        cooperativeHasOtherOfficer: undefined,
      }),
    ).toBe(false);
    expect(can(admin, "lot:approve")).toBe(false);
  });

  it("admin_cannot_approve_own_lot", () => {
    const admin = actor("ADMIN");
    expect(
      can(admin, "lot:approve", {
        cooperativeId: COOP,
        ownerUserId: admin.userId,
        cooperativeHasOtherOfficer: false,
      }),
    ).toBe(false);
  });

  it("admin_cannot_approve_when_owner_unknown", () => {
    expect(
      can(actor("ADMIN"), "lot:approve", {
        cooperativeId: COOP,
        cooperativeHasOtherOfficer: false,
      }),
    ).toBe(false);
  });
});

describe("bank:change", () => {
  it("denies an officer without two-factor", () => {
    const officer = { ...actor("OFFICER", COOP), twoFactorEnabled: false };
    expect(can(officer, "bank:change", { cooperativeId: COOP })).toBe(false);
  });

  it("denies an officer of another cooperative", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "bank:change", { cooperativeId: COOP })).toBe(false);
  });

  it("denies an officer with a null cooperativeId or no resource", () => {
    expect(can(actor("OFFICER", null), "bank:change", {})).toBe(false);
    expect(can(actor("OFFICER", COOP), "bank:change")).toBe(false);
  });
});
