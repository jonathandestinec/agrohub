import { describe, expect, it } from "vitest";
import { navLinksFor, navLinksWithoutActiveMembership } from "@/components/nav-links";
import { centreNavLinks, isCurrent, showRoleSwitcher } from "@/components/nav-current";

describe("navLinksFor", () => {
  it("gives officers onboarding, invites, farmers and lot screening", () => {
    expect(navLinksFor("OFFICER")).toEqual([
      { href: "/officer/onboarding", labelKey: "cooperative" },
      { href: "/officer/invites", labelKey: "invites" },
      { href: "/officer/farmers", labelKey: "farmers" },
      { href: "/officer/lots", labelKey: "screenLots" },
      { href: "/officer/offers", labelKey: "offers" },
      { href: "/messages", labelKey: "messages" },
    ]);
  });

  it("gives admins the cooperatives queue, the lot queue and platform settings", () => {
    expect(navLinksFor("ADMIN")).toEqual([
      { href: "/admin/cooperatives", labelKey: "reviewCooperatives" },
      { href: "/admin/lots", labelKey: "lotQueue" },
      { href: "/admin/settings", labelKey: "platformSettings" },
    ]);
  });

  it("gives farmers their farmer page, their lots and the price board", () => {
    expect(navLinksFor("FARMER")).toEqual([
      { href: "/farmer", labelKey: "farm" },
      { href: "/farmer/lots", labelKey: "myLots" },
      { href: "/messages", labelKey: "messages" },
      { href: "/prices", labelKey: "prices" },
    ]);
  });

  it("gives board admins price entry, crops and units, and the price board", () => {
    expect(navLinksFor("BOARD_ADMIN").map((l) => l.href)).toEqual([
      "/board",
      "/board/crops",
      "/prices",
    ]);
  });

  it("gives buyers the lot list and their offers", () => {
    expect(navLinksFor("BUYER")).toEqual([
      { href: "/lots", labelKey: "browseLots" },
      { href: "/buyer", labelKey: "myOffers" },
      { href: "/messages", labelKey: "messages" },
    ]);
  });

  it("gives no links without a role", () => {
    expect(navLinksFor(null)).toEqual([]);
  });
});

describe("navLinksWithoutActiveMembership", () => {
  const register = [
    { href: "/officer/onboarding", labelKey: "registerCooperative" },
    { href: "/buyer/join", labelKey: "buyProduce" },
  ];
  const yourFarm = [{ href: "/farmer", labelKey: "yourFarm" }];

  it("offers to register a cooperative or buy produce to a user with no officer or farmer membership", () => {
    expect(navLinksWithoutActiveMembership([])).toEqual(register);
    expect(navLinksWithoutActiveMembership([{ role: "BUYER", status: "PENDING" }])).toEqual(
      register,
    );
  });

  it("links a PENDING farmer to their farm page", () => {
    expect(navLinksWithoutActiveMembership([{ role: "FARMER", status: "PENDING" }])).toEqual(
      yourFarm,
    );
  });

  it("gives no link to a user whose farmer membership ended or who has an officer membership", () => {
    expect(navLinksWithoutActiveMembership([{ role: "FARMER", status: "LEFT" }])).toEqual([]);
    expect(navLinksWithoutActiveMembership([{ role: "FARMER", status: "REMOVED" }])).toEqual([]);
    expect(navLinksWithoutActiveMembership([{ role: "OFFICER", status: "REMOVED" }])).toEqual([]);
  });

  it("prefers the farm page when a farmer is also pending elsewhere", () => {
    expect(
      navLinksWithoutActiveMembership([
        { role: "FARMER", status: "LEFT" },
        { role: "FARMER", status: "PENDING" },
      ]),
    ).toEqual(yourFarm);
  });
});

describe("isCurrent", () => {
  it("matches exact and nested paths", () => {
    expect(isCurrent("/officer/farmers", "/officer/farmers")).toBe(true);
    expect(isCurrent("/admin/cooperatives/abc", "/admin/cooperatives")).toBe(true);
  });

  it("does not match a shared prefix or a sibling", () => {
    expect(isCurrent("/farmers-old", "/farmer")).toBe(false);
    expect(isCurrent("/officer/invites", "/officer/farmers")).toBe(false);
  });
});

describe("centreNavLinks", () => {
  it("keeps one or two links beside the account action", () => {
    expect(centreNavLinks(1)).toBe(false);
    expect(centreNavLinks(2)).toBe(false);
  });

  it("centres three or more links in the bar", () => {
    expect(centreNavLinks(3)).toBe(true);
    expect(centreNavLinks(6)).toBe(true);
  });
});

describe("showRoleSwitcher", () => {
  it("shows the switcher only to someone with two or more memberships", () => {
    expect(showRoleSwitcher(0)).toBe(false);
    expect(showRoleSwitcher(1)).toBe(false);
    expect(showRoleSwitcher(2)).toBe(true);
  });
});
