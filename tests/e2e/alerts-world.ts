// Shared by the alerts and live-updates e2e specs: a verified cooperative with a live lot, its
// officer signed in, and a buyer signed in and looking at the lot.
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clickNav, completeSignUp, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// Every locator is scoped to the header bar or to <main>: Next keeps earlier routes in the DOM.
export const bar = (page: Page) => page.locator(".nav-bar");
export const bell = (page: Page, name: string | RegExp) => bar(page).getByRole("button", { name });

export type World = {
  officerPage: Page;
  buyerPage: Page;
  crop: string;
  unit: string;
  buyerName: string;
};

// A verified cooperative with a live lot, its officer signed in, and a buyer signed in and
// looking at the lot. next dev compiles each route on first use, so the ones used are warmed.
export async function startWorld(browser: Browser, request: APIRequestContext): Promise<World> {
  const tag = uniqueTag();
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("alerts-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("alerts-farmer") };
  const buyer = { name: `Ada ${tag}`, email: uniqueEmail("alerts-buyer") };
  const officerPage = await newPage(browser);
  const farmerPage = await newPage(browser);
  const buyerPage = await newPage(browser);

  for (const path of ["/buyer/join", "/buyer", "/lots", "/lots/warm", "/officer/offers", "/officer/offers/warm",
    "/officer/lots", "/messages", "/messages/warm", "/alerts", "/api/alerts/summary"]) {
    await request.get(path, { timeout: 120_000 });
  }
  for (const [page, user] of [
    [officerPage, officer],
    [farmerPage, farmer],
    [buyerPage, buyer],
  ] as const) {
    await page.goto("/sign-up");
    await completeSignUp(page, request, user);
  }
  await setUpLotWorld({
    tag,
    cooperative: `Harvest ${tag} Cooperative`,
    crop,
    unit,
    officerEmail: officer.email,
    farmerEmail: farmer.email,
    liveLot: { quantity: 30, askKobo: 6_500_000, floorKobo: 4_321_987, minOrderQty: 5 },
  });
  await signIn(officerPage, officer.email);
  await expect(officerPage).toHaveURL(LANDING.officer);
  await signIn(buyerPage, buyer.email);
  await expect(buyerPage).toHaveURL(HOME);
  await clickNav(buyerPage, "Buy produce");
  await buyerPage.getByRole("main").getByRole("button", { name: "Start buying" }).click();
  await expect(buyerPage.getByRole("heading", { name: /^Home, / })).toBeVisible();

  await clickNav(buyerPage, "Browse lots");
  const main = buyerPage.getByRole("main");
  await main.getByLabel("Crop").selectOption({ label: crop });
  await main.getByRole("button", { name: "Show lots" }).click();
  await main.getByRole("listitem").filter({ hasText: crop }).getByRole("link").click();
  await expect(buyerPage.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
  return { officerPage, buyerPage, crop, unit, buyerName: buyer.name };
}

export async function makeOffer(world: World): Promise<void> {
  const main = world.buyerPage.getByRole("main");
  await main.getByLabel(`Quantity (${world.unit})`).fill("10");
  await main.getByLabel(`Your price per ${world.unit} (₦)`).fill("65000");
  await main.getByRole("button", { name: "Make offer" }).click();
  await expect(world.buyerPage.getByRole("heading", { name: `10 × ${world.unit} of ${world.crop}` })).toBeVisible();
}

export async function writeToCooperative(page: Page, text: string): Promise<void> {
  const main = page.getByRole("main");
  const open = main.getByRole("button", { name: "Message the cooperative" });
  if (await open.isVisible()) await open.click();
  await main.getByLabel("Your message").fill(text);
  await main.getByRole("button", { name: "Send" }).click();
  await expect(main.getByText(text)).toBeVisible();
}

