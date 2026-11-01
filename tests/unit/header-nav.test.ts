import { describe, expect, it } from "vitest";
import { navLinksFor } from "@/components/nav-links";

describe("navLinksFor", () => {
  it("gives officers onboarding, invites and farmers", () => {
    expect(navLinksFor("OFFICER")).toEqual([
      { href: "/officer/onboarding", labelKey: "cooperative" },
      { href: "/officer/invites", labelKey: "invites" },
      { href: "/officer/farmers", labelKey: "farmers" },
    ]);
  });

  it("gives admins the cooperatives queue", () => {
    expect(navLinksFor("ADMIN")).toEqual([
      { href: "/admin/cooperatives", labelKey: "reviewCooperatives" },
    ]);
  });

  it("gives farmers their farmer page", () => {
    expect(navLinksFor("FARMER")).toEqual([{ href: "/farmer", labelKey: "farm" }]);
  });

  it.each(["BUYER", "BOARD_ADMIN", null] as const)("gives %s no links yet", (role) => {
    expect(navLinksFor(role)).toEqual([]);
  });
});
