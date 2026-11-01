import { describe, expect, it } from "vitest";
import { pickActiveMembership } from "@/modules/identity/active-role";
import type { Membership } from "@/modules/identity/service";

function m(id: string, role: Membership["role"]): Membership {
  return {
    id,
    userId: "u1",
    role,
    cooperativeId: role === "FARMER" || role === "OFFICER" ? "c1" : null,
    status: "ACTIVE",
    approvedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  } as Membership;
}

describe("pickActiveMembership", () => {
  it("returns the preferred membership when it is in the list", () => {
    const list = [m("a", "OFFICER"), m("b", "BUYER")];
    expect(pickActiveMembership(list, "b")?.id).toBe("b");
  });

  it("falls back to priority order when there is no preference", () => {
    const list = [m("a", "BUYER"), m("b", "OFFICER")];
    expect(pickActiveMembership(list)?.role).toBe("OFFICER");
  });

  it("returns null for an empty list", () => {
    expect(pickActiveMembership([])).toBeNull();
    expect(pickActiveMembership([], "a")).toBeNull();
  });

  it("ignores a preferred id that is not in the list", () => {
    const list = [m("a", "BUYER"), m("b", "FARMER")];
    expect(pickActiveMembership(list, "zzz")?.id).toBe("b");
  });
});
