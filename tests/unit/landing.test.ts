import { describe, expect, it } from "vitest";
import { landingPath } from "@/modules/identity/landing";

describe("landingPath", () => {
  it("sends each role to the page they work from when nothing was asked for", () => {
    const go = (role: Parameters<typeof landingPath>[0]["role"], cooperativeVerified = true) =>
      landingPath({ next: "/", role, cooperativeVerified });
    expect(go("ADMIN")).toBe("/admin/orders");
    expect(go("BOARD_ADMIN")).toBe("/board");
    expect(go("OFFICER")).toBe("/officer/orders");
    expect(go("FARMER")).toBe("/farmer");
    expect(go("BUYER")).toBe("/lots");
  });

  it("sends an officer of a cooperative that is not verified to onboarding", () => {
    expect(landingPath({ next: "/", role: "OFFICER", cooperativeVerified: false })).toBe("/officer/onboarding");
  });

  it("keeps a person with no active membership on the home page", () => {
    expect(landingPath({ next: "/", role: null, cooperativeVerified: false })).toBe("/");
  });

  it("lets an explicit safe next win over the role's page", () => {
    expect(landingPath({ next: "/lots/abc", role: "ADMIN", cooperativeVerified: true })).toBe("/lots/abc");
    expect(landingPath({ next: "/join/token", role: null, cooperativeVerified: false })).toBe("/join/token");
  });

  it("ignores a next that is not a safe path on this site", () => {
    expect(landingPath({ next: "https://evil.example", role: "BUYER", cooperativeVerified: true })).toBe("/lots");
    expect(landingPath({ next: "//evil.example", role: "FARMER", cooperativeVerified: true })).toBe("/farmer");
    expect(landingPath({ next: "", role: "FARMER", cooperativeVerified: true })).toBe("/farmer");
  });
});
