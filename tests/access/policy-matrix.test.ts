import { describe, expect, it } from "vitest";
import {
  can,
  type Action,
  type Actor,
  type Role,
} from "@/modules/identity/policies";

const COOP = "coop-1";
const OTHER_COOP = "coop-2";

function actor(role: Role, cooperativeId: string | null = null): Actor {
  return { userId: "user-1", role, cooperativeId };
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
];

describe("policy matrix", () => {
  it.each(matrix)("%s as %s -> %s", (action, role, expected) => {
    const cooperativeId = role === "OFFICER" || role === "FARMER" ? COOP : null;
    expect(can(actor(role, cooperativeId), action, own)).toBe(expected);
  });

  it("covers every action and role", () => {
    expect(matrix).toHaveLength(25);
  });
});

describe("cooperative scoping", () => {
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
});
