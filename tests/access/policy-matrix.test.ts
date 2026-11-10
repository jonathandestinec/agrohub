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

  ["setting:write", "FARMER", false],
  ["setting:write", "OFFICER", false],
  ["setting:write", "BUYER", false],
  ["setting:write", "ADMIN", true],
  ["setting:write", "BOARD_ADMIN", false],

  // farmer:profile, like farmer:leave, is checked against a resource the actor owns.
  ["farmer:profile", "FARMER", true],
  ["farmer:profile", "OFFICER", false],
  ["farmer:profile", "BUYER", false],
  ["farmer:profile", "ADMIN", false],
  ["farmer:profile", "BOARD_ADMIN", false],

  ["catalog:request", "FARMER", true],
  ["catalog:request", "OFFICER", false],
  ["catalog:request", "BUYER", false],
  ["catalog:request", "ADMIN", false],
  ["catalog:request", "BOARD_ADMIN", false],

  ["catalog:forward", "FARMER", false],
  ["catalog:forward", "OFFICER", true],
  ["catalog:forward", "BUYER", false],
  ["catalog:forward", "ADMIN", false],
  ["catalog:forward", "BOARD_ADMIN", false],

  ["lot:submit", "FARMER", true],
  ["lot:submit", "OFFICER", false],
  ["lot:submit", "BUYER", false],
  ["lot:submit", "ADMIN", false],
  ["lot:submit", "BOARD_ADMIN", false],

  // lot:own is checked against a lot the farmer owns.
  ["lot:own", "FARMER", true],
  ["lot:own", "OFFICER", false],
  ["lot:own", "BUYER", false],
  ["lot:own", "ADMIN", false],
  ["lot:own", "BOARD_ADMIN", false],

  ["lot:screen", "FARMER", false],
  ["lot:screen", "OFFICER", true],
  ["lot:screen", "BUYER", false],
  ["lot:screen", "ADMIN", true],
  ["lot:screen", "BOARD_ADMIN", false],

  ["offer:make", "FARMER", false],
  ["offer:make", "OFFICER", false],
  ["offer:make", "BUYER", true],
  ["offer:make", "ADMIN", false],
  ["offer:make", "BOARD_ADMIN", false],

  // offer:own is checked against an offer the buyer made.
  ["offer:own", "FARMER", false],
  ["offer:own", "OFFICER", false],
  ["offer:own", "BUYER", true],
  ["offer:own", "ADMIN", false],
  ["offer:own", "BOARD_ADMIN", false],

  ["offer:respond", "FARMER", false],
  ["offer:respond", "OFFICER", true],
  ["offer:respond", "BUYER", false],
  ["offer:respond", "ADMIN", false],
  ["offer:respond", "BOARD_ADMIN", false],

  // thread:participate without a threadKind: buyers and farmers need their own kind (below).
  ["thread:participate", "FARMER", false],
  ["thread:participate", "OFFICER", true],
  ["thread:participate", "BUYER", false],
  ["thread:participate", "ADMIN", true],
  ["thread:participate", "BOARD_ADMIN", false],

  ["cooperative:rename", "FARMER", false],
  ["cooperative:rename", "OFFICER", true],
  ["cooperative:rename", "BUYER", false],
  ["cooperative:rename", "ADMIN", false],
  ["cooperative:rename", "BOARD_ADMIN", false],

  ["name:queue", "FARMER", false],
  ["name:queue", "OFFICER", false],
  ["name:queue", "BUYER", false],
  ["name:queue", "ADMIN", true],
  ["name:queue", "BOARD_ADMIN", false],

  // name:decide is checked with actorInCooperative: false (see below).
  ["name:decide", "FARMER", false],
  ["name:decide", "OFFICER", false],
  ["name:decide", "BUYER", false],
  ["name:decide", "ADMIN", true],
  ["name:decide", "BOARD_ADMIN", false],

  ["order:checkout", "FARMER", false],
  ["order:checkout", "OFFICER", false],
  ["order:checkout", "BUYER", true],
  ["order:checkout", "ADMIN", false],
  ["order:checkout", "BOARD_ADMIN", false],

  // order:own is checked against an order the buyer placed.
  ["order:own", "FARMER", false],
  ["order:own", "OFFICER", false],
  ["order:own", "BUYER", true],
  ["order:own", "ADMIN", false],
  ["order:own", "BOARD_ADMIN", false],

  ["order:manage", "FARMER", false],
  ["order:manage", "OFFICER", true],
  ["order:manage", "BUYER", false],
  ["order:manage", "ADMIN", false],
  ["order:manage", "BOARD_ADMIN", false],

  ["order:admin", "FARMER", false],
  ["order:admin", "OFFICER", false],
  ["order:admin", "BUYER", false],
  ["order:admin", "ADMIN", true],
  ["order:admin", "BOARD_ADMIN", false],

  ["payout:manage", "FARMER", false],
  ["payout:manage", "OFFICER", false],
  ["payout:manage", "BUYER", false],
  ["payout:manage", "ADMIN", true],
  ["payout:manage", "BOARD_ADMIN", false],

  ["quote:make", "FARMER", false],
  ["quote:make", "OFFICER", true],
  ["quote:make", "BUYER", false],
  ["quote:make", "ADMIN", false],
  ["quote:make", "BOARD_ADMIN", false],

  // earnings:own is checked against the farmer's own statements.
  ["earnings:own", "FARMER", true],
  ["earnings:own", "OFFICER", false],
  ["earnings:own", "BUYER", false],
  ["earnings:own", "ADMIN", false],
  ["earnings:own", "BOARD_ADMIN", false],

  // notification:own needs the owner to be the actor; the matrix resource has no owner.
  ["notification:own", "FARMER", false],
  ["notification:own", "OFFICER", false],
  ["notification:own", "BUYER", false],
  ["notification:own", "ADMIN", false],
  ["notification:own", "BOARD_ADMIN", false],
];

describe("policy matrix", () => {
  it.each(matrix)("%s as %s -> %s", (action, role, expected) => {
    const cooperativeId = role === "OFFICER" || role === "FARMER" ? COOP : null;
    const resource =
      action === "farmer:leave" ||
      action === "farmer:profile" ||
      action === "lot:own" ||
      action === "offer:own" ||
      action === "order:own" ||
      action === "earnings:own"
        ? { ...own, ownerUserId: "user-1" }
        : action === "name:decide"
          ? { ...own, actorInCooperative: false }
          : own;
    expect(can(actor(role, cooperativeId), action, resource)).toBe(expected);
  });

  it("covers every action and role", () => {
    expect(matrix).toHaveLength(190);
  });
});

describe("notification:own", () => {
  it.each(["FARMER", "OFFICER", "BUYER", "ADMIN", "BOARD_ADMIN"] as const)(
    "allows_%s_to_read_their_own_alerts",
    (role) => {
      expect(can(actor(role, COOP), "notification:own", { ownerUserId: "user-1" })).toBe(true);
    },
  );
  it("denies_another_persons_alerts", () => {
    expect(can(actor("ADMIN"), "notification:own", { ownerUserId: "someone-else" })).toBe(false);
  });
  it("denies_when_no_owner_is_given", () => {
    expect(can(actor("BUYER"), "notification:own")).toBe(false);
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

describe("thread participation", () => {
  const buyer: Actor = { userId: "buyer-1", role: "BUYER", cooperativeId: null, twoFactorEnabled: false };
  const farmer: Actor = { userId: "farmer-1", role: "FARMER", cooperativeId: COOP, twoFactorEnabled: false };
  const officer: Actor = { userId: "officer-1", role: "OFFICER", cooperativeId: COOP, twoFactorEnabled: true };

  it("lets a buyer into their own buyer thread only", () => {
    expect(can(buyer, "thread:participate", { cooperativeId: COOP, ownerUserId: "buyer-1", threadKind: "BUYER_COOPERATIVE" })).toBe(true);
    expect(can(buyer, "thread:participate", { cooperativeId: COOP, ownerUserId: "buyer-2", threadKind: "BUYER_COOPERATIVE" })).toBe(false);
    expect(can(buyer, "thread:participate", { cooperativeId: COOP, ownerUserId: "buyer-1", threadKind: "FARMER_COOPERATIVE" })).toBe(false);
  });

  it("lets a farmer into their own farmer thread in their cooperative only", () => {
    expect(can(farmer, "thread:participate", { cooperativeId: COOP, ownerUserId: "farmer-1", threadKind: "FARMER_COOPERATIVE" })).toBe(true);
    expect(can(farmer, "thread:participate", { cooperativeId: COOP, ownerUserId: "farmer-1", threadKind: "BUYER_COOPERATIVE" })).toBe(false);
    expect(can(farmer, "thread:participate", { cooperativeId: OTHER_COOP, ownerUserId: "farmer-1", threadKind: "FARMER_COOPERATIVE" })).toBe(false);
  });

  it("lets an officer into any thread of their own cooperative only", () => {
    expect(can(officer, "thread:participate", { cooperativeId: COOP, ownerUserId: "buyer-1", threadKind: "BUYER_COOPERATIVE" })).toBe(true);
    expect(can(officer, "thread:participate", { cooperativeId: OTHER_COOP, ownerUserId: "buyer-1", threadKind: "BUYER_COOPERATIVE" })).toBe(false);
  });
});

describe("cooperative:rename", () => {
  it("denies an officer without two-factor", () => {
    const officer = { ...actor("OFFICER", COOP), twoFactorEnabled: false };
    expect(can(officer, "cooperative:rename", { cooperativeId: COOP })).toBe(false);
  });

  it("denies an officer of another cooperative or with no resource", () => {
    expect(can(actor("OFFICER", OTHER_COOP), "cooperative:rename", { cooperativeId: COOP })).toBe(false);
    expect(can(actor("OFFICER", COOP), "cooperative:rename")).toBe(false);
  });
});

describe("name:decide", () => {
  const admin = actor("ADMIN");
  it("denies an admin deciding their own request", () => {
    expect(can(admin, "name:decide", { ownerUserId: "user-1", actorInCooperative: false })).toBe(false);
  });

  it("denies an admin who belongs to the cooperative, or when that is unknown", () => {
    expect(can(admin, "name:decide", { ownerUserId: "farmer-9", actorInCooperative: true })).toBe(false);
    expect(can(admin, "name:decide", { ownerUserId: "farmer-9" })).toBe(false);
    expect(can(admin, "name:decide")).toBe(false);
  });
});
