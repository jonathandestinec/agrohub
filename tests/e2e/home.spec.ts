import { expect, test } from "@playwright/test";
import { grantRole } from "./grant";
import { makeBuyer, makePendingFarmer } from "./home-world";
import { completeSignUp, enrolTwoFactor, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// The role home pages: each role lands on its own after sign-in, a tile item opens the item, and
// the two pages that moved (the farm details and the buyer's offer list) are where the nav says.

test("each role lands on its home, and a tile item opens its page", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const tag = uniqueTag();
  const cooperative = `Harvest ${tag} Cooperative`;
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("home-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("home-farmer") };
  const buyer = { name: `Ada ${tag}`, email: uniqueEmail("home-buyer") };
  const admin = { name: "Admin Bisi", email: uniqueEmail("home-admin") };
  const pending = { name: `Pending ${tag}`, email: uniqueEmail("home-pending") };

  const pages = {
    officer: await newPage(browser),
    farmer: await newPage(browser),
    buyer: await newPage(browser),
    admin: await newPage(browser),
    pending: await newPage(browser),
  };

  await test.step("setup", async () => {
    for (const path of ["/officer", "/officer/offers", "/officer/offers/warm", "/farmer", "/farmer/profile", "/buyer",
      "/buyer/offers", "/buyer/offers/warm", "/admin", "/lots", "/lots/warm", "/two-factor"]) {
      await request.get(path, { timeout: 120_000 });
    }
    for (const [key, user] of [
      ["officer", officer], ["farmer", farmer], ["buyer", buyer], ["admin", admin], ["pending", pending],
    ] as const) {
      await pages[key].goto("/sign-up");
      await completeSignUp(pages[key], request, user);
    }
    await setUpLotWorld({
      tag, cooperative, crop, unit, officerEmail: officer.email, farmerEmail: farmer.email,
      liveLot: { quantity: 30, askKobo: 6_500_000, floorKobo: 4_321_987, minOrderQty: 5 },
    });
    await makeBuyer(buyer.email);
    await makePendingFarmer(pending.email, cooperative);
    await grantRole(admin.email, "ADMIN");
  });

  await test.step("1. officer, farmer and buyer land on their home", async () => {
    await signIn(pages.officer, officer.email);
    await expect(pages.officer).toHaveURL(LANDING.officer);
    await expect(pages.officer.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("Home, Ngozi");
    await signIn(pages.farmer, farmer.email);
    await expect(pages.farmer).toHaveURL(LANDING.farmer);
    await expect(pages.farmer.getByRole("main").getByRole("heading", { level: 1 })).toContainText("Home, Musa");
    await signIn(pages.buyer, buyer.email);
    await expect(pages.buyer).toHaveURL(LANDING.buyer);
    await expect(pages.buyer.getByRole("main").getByRole("heading", { level: 1 })).toContainText("Home, Ada");
  });

  await test.step("2. the admin lands on their home after two-factor", async () => {
    await signIn(pages.admin, admin.email);
    await expect(pages.admin).toHaveURL(LANDING.twoFactor);
    await enrolTwoFactor(pages.admin);
    await expect(pages.admin).toHaveURL(LANDING.admin);
    await expect(pages.admin.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("Home, Admin");
  });

  await test.step("3. a buyer's offer shows on the officer's tile and its row opens the offer", async () => {
    const page = pages.buyer;
    await page.goto("/lots");
    await page.getByRole("main").getByRole("listitem").filter({ hasText: crop }).getByRole("link").click();
    const lotMain = page.getByRole("main");
    await lotMain.getByLabel(`Quantity (${unit})`).fill("10");
    await lotMain.getByLabel(`Your price per ${unit} (₦)`).fill("60000");
    await lotMain.getByRole("button", { name: "Make offer" }).click();
    await expect(lotMain.getByText("Waiting for the cooperative")).toBeVisible();

    const officerPage = pages.officer;
    await officerPage.goto("/officer");
    const tile = officerPage.getByRole("main").getByRole("group", { name: "Offers to answer" }).locator("..");
    await expect(tile).toContainText("1");
    await tile.getByRole("link", { name: new RegExp(`10 ${unit} · ${crop}`) }).click();
    await expect(officerPage).toHaveURL(/\/officer\/offers\/[^/]+$/);
  });

  await test.step("4. the buyer's offers have their own page", async () => {
    const page = pages.buyer;
    await page.goto("/buyer/offers");
    await expect(page.getByRole("main").getByRole("heading", { name: "My offers" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: crop })).toHaveCount(1);
    await page.goto("/buyer");
    await expect(page.getByRole("main").getByRole("link", { name: "Browse lots" })).toBeVisible();
  });

  await test.step("5. a pending farmer is sent to the farm page", async () => {
    const page = pages.pending;
    await signIn(page, pending.email);
    await expect(page).toHaveURL(HOME);
    await page.goto("/farmer");
    await expect(page).toHaveURL(/\/farmer\/profile$/);
    await expect(page.getByRole("main").getByRole("heading", { name: cooperative })).toBeVisible();
  });

  await test.step("6. a farmer using the buyer role is sent to the farm page, not a 404", async () => {
    const page = await newPage(browser);
    await makeBuyer(farmer.email);
    await signIn(page, farmer.email);
    await expect(page).toHaveURL(LANDING.farmer);
    await page.getByLabel("Acting as").selectOption({ label: "Buyer" });
    await expect(page.getByRole("navigation").getByRole("link", { name: "Browse lots", exact: true })).toBeVisible();
    await page.goto("/farmer");
    await expect(page).toHaveURL(/\/farmer\/profile$/);
    await expect(page.getByRole("main").getByRole("heading", { name: cooperative })).toBeVisible();
  });
});
