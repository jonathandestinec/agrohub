import { describe, expect, it } from "vitest";
import {
  flattenNav,
  navItemsFor,
  navItemsSignedOut,
  type NavItem,
} from "@/components/nav-links";
import { currentHref, itemIsCurrent } from "@/components/nav-current";

// A compact picture of the bar: a link is its href, a group is "Label: href, href".
function shape(items: NavItem[]): string[] {
  return items.map((item) =>
    item.kind === "link" ? item.href : `${item.labelKey}: ${item.links.map((l) => l.href).join(", ")}`,
  );
}

describe("navItemsFor", () => {
  it("gives admins Review, Orders and More", () => {
    expect(shape(navItemsFor("ADMIN"))).toEqual([
      "groupReview: /admin/cooperatives, /admin/names, /admin/lots",
      "groupOrders: /admin/orders, /admin/payouts",
      "groupMore: /messages, /admin/settings",
    ]);
  });

  it("gives officers Cooperative, Selling and Messages", () => {
    expect(shape(navItemsFor("OFFICER"))).toEqual([
      "groupCooperative: /officer/onboarding, /officer/farmers, /officer/invites",
      "groupSelling: /officer/lots, /officer/offers, /officer/orders, /prices",
      "/messages",
    ]);
  });

  it("gives farmers My farm, Selling and More", () => {
    expect(shape(navItemsFor("FARMER"))).toEqual([
      "/farmer",
      "groupSelling: /farmer/lots, /farmer/earnings",
      "groupMore: /messages, /prices",
    ]);
  });

  it("gives buyers Browse lots, My buying and More", () => {
    expect(shape(navItemsFor("BUYER"))).toEqual([
      "/lots",
      "groupBuying: /buyer, /buyer/orders",
      "groupMore: /messages, /prices",
    ]);
  });

  it("leaves board admins three plain links", () => {
    expect(shape(navItemsFor("BOARD_ADMIN"))).toEqual(["/board", "/board/crops", "/prices"]);
  });

  it("gives no items without a role", () => {
    expect(navItemsFor(null)).toEqual([]);
  });

  it("never puts more than three items in the bar", () => {
    for (const role of ["ADMIN", "OFFICER", "FARMER", "BUYER", "BOARD_ADMIN"] as const) {
      expect(navItemsFor(role).length).toBeLessThanOrEqual(3);
    }
  });

  it("reaches every list and queue page a role can open", () => {
    const reach = (role: Parameters<typeof navItemsFor>[0]) => flattenNav(navItemsFor(role)).map((l) => l.href);
    expect(reach("ADMIN")).toEqual(
      expect.arrayContaining(["/admin/cooperatives", "/admin/names", "/admin/lots", "/admin/settings", "/admin/orders", "/admin/payouts", "/messages"]),
    );
    expect(reach("OFFICER")).toEqual(
      expect.arrayContaining(["/officer/onboarding", "/officer/invites", "/officer/farmers", "/officer/lots", "/officer/offers", "/officer/orders", "/messages"]),
    );
    expect(reach("FARMER")).toEqual(
      expect.arrayContaining(["/farmer", "/farmer/lots", "/farmer/earnings", "/messages", "/prices"]),
    );
    expect(reach("BUYER")).toEqual(
      expect.arrayContaining(["/lots", "/buyer", "/buyer/orders", "/messages", "/prices"]),
    );
  });
});

describe("navItemsSignedOut", () => {
  it("offers the lots and the price board", () => {
    expect(shape(navItemsSignedOut())).toEqual(["/lots", "/prices"]);
  });
});

describe("currentHref", () => {
  const hrefs = ["/farmer", "/farmer/lots", "/farmer/earnings"];

  it("picks the longest matching link, so a page under My lots does not also light My farm", () => {
    expect(currentHref("/farmer/lots/abc", hrefs)).toBe("/farmer/lots");
    expect(currentHref("/farmer", hrefs)).toBe("/farmer");
  });

  it("is null when no link matches", () => {
    expect(currentHref("/prices", hrefs)).toBeNull();
    expect(currentHref("/farmers-old", hrefs)).toBeNull();
  });
});

describe("itemIsCurrent", () => {
  const items = navItemsFor("ADMIN");
  const all = flattenNav(items).map((l) => l.href);

  it("marks the group that holds the current page", () => {
    expect(itemIsCurrent(items[1], "/admin/payouts", all)).toBe(true);
    expect(itemIsCurrent(items[0], "/admin/payouts", all)).toBe(false);
    expect(itemIsCurrent(items[0], "/admin/lots/abc", all)).toBe(true);
  });
});
