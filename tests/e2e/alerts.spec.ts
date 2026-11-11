import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { clickNav, completeSignUp, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// Every locator is scoped to the header bar or to <main>: Next keeps earlier routes in the DOM.
const bar = (page: Page) => page.locator(".nav-bar");
const bell = (page: Page, name: string | RegExp) => bar(page).getByRole("button", { name });

type World = {
  officerPage: Page;
  buyerPage: Page;
  crop: string;
  unit: string;
  buyerName: string;
};

// A verified cooperative with a live lot, its officer signed in, and a buyer signed in and
// looking at the lot. next dev compiles each route on first use, so the ones used are warmed.
async function startWorld(browser: Browser, request: APIRequestContext): Promise<World> {
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
  await expect(buyerPage.getByRole("heading", { name: "My offers" })).toBeVisible();

  await clickNav(buyerPage, "Browse lots");
  const main = buyerPage.getByRole("main");
  await main.getByLabel("Crop").selectOption({ label: crop });
  await main.getByRole("button", { name: "Show lots" }).click();
  await main.getByRole("listitem").filter({ hasText: crop }).getByRole("link").click();
  await expect(buyerPage.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
  return { officerPage, buyerPage, crop, unit, buyerName: buyer.name };
}

async function makeOffer(world: World): Promise<void> {
  const main = world.buyerPage.getByRole("main");
  await main.getByLabel(`Quantity (${world.unit})`).fill("10");
  await main.getByLabel(`Your price per ${world.unit} (₦)`).fill("65000");
  await main.getByRole("button", { name: "Make offer" }).click();
  await expect(world.buyerPage.getByRole("heading", { name: `10 × ${world.unit} of ${world.crop}` })).toBeVisible();
}

async function writeToCooperative(page: Page, text: string): Promise<void> {
  const main = page.getByRole("main");
  const open = main.getByRole("button", { name: "Message the cooperative" });
  if (await open.isVisible()) await open.click();
  await main.getByLabel("Your message").fill(text);
  await main.getByRole("button", { name: "Send" }).click();
  await expect(main.getByText(text)).toBeVisible();
}

test.describe("alerts", () => {
  test.setTimeout(420_000);

  test("an officer is told about a new offer and the count clears", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const page = world.officerPage;

    await test.step("no alert yet", async () => {
      await expect(bell(page, "Alerts, none unread")).toBeVisible();
    });
    await makeOffer(world);

    await test.step("following a link inside the app refreshes the count without a reload", async () => {
      await clickNav(page, "Offers");
      await expect(bell(page, "Alerts, 1 unread")).toBeVisible();
    });

    await test.step("a message in the thread adds a second alert", async () => {
      await writeToCooperative(world.buyerPage, "Can you deliver to Ibadan?");
      await clickNav(page, "Messages");
      await expect(bell(page, "Alerts, 2 unread")).toBeVisible();
    });

    await test.step("opening the offer alert lands on the offer and the count drops", async () => {
      await bell(page, "Alerts, 2 unread").click();
      await bar(page).getByRole("button", { name: /New offer for 10/ }).click();
      await expect(page).toHaveURL(/\/officer\/offers\/[^/]+$/);
      await expect(bell(page, "Alerts, 1 unread")).toBeVisible();
    });

    await test.step("Mark all as read clears it", async () => {
      await bell(page, "Alerts, 1 unread").click();
      await bar(page).getByRole("button", { name: "Mark all as read" }).click();
      await expect(bell(page, "Alerts, none unread")).toBeVisible();
    });
  });

  test("the bell follows the alerts page and an alert for the current page", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const page = world.officerPage;
    await makeOffer(world);
    await writeToCooperative(world.buyerPage, "Is the maize dry?");

    await test.step("an alert for the page the officer is already on keeps them there", async () => {
      await clickNav(page, "Messages");
      await page.getByRole("main").getByRole("link", { name: new RegExp(world.buyerName) }).click();
      await expect(page).toHaveURL(/\/messages\/[^/]+$/);
      const here = page.url();
      await expect(bell(page, "Alerts, 2 unread")).toBeVisible();
      await bell(page, "Alerts, 2 unread").click();
      await bar(page).getByRole("button", { name: /New message about/ }).click();
      await expect(page).toHaveURL(here);
      await expect(bell(page, "Alerts, 1 unread")).toBeVisible();
    });

    await test.step("Mark all as read on the alerts page updates the bell without leaving it", async () => {
      await page.goto("/alerts");
      const main = page.getByRole("main");
      await expect(main.getByText(/New offer for 10/)).toBeVisible();
      await main.getByRole("button", { name: "Mark all as read" }).click();
      await expect(bell(page, "Alerts, none unread")).toBeVisible();
      await expect(page).toHaveURL(/\/alerts$/);
    });
  });

  test("on a phone the bell is in the header and opens the alerts page", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const page = world.officerPage;
    await makeOffer(world);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/officer/offers");
    // Visible without opening the menu, beside the account button.
    const link = bar(page).getByRole("link", { name: "Alerts, 1 unread" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/alerts$/);
    await expect(page.getByRole("main").getByText(/New offer for 10/)).toBeVisible();
  });

  test("a signed-in person with no role is sent away from the alerts page without an error", async ({ browser, request }) => {
    const page = await newPage(browser);
    const user = { name: "Nobody Yet", email: uniqueEmail("alerts-norole") };
    await page.goto("/sign-up");
    await completeSignUp(page, request, user);
    await page.goto("/alerts");
    await expect(page).not.toHaveURL(/\/alerts$/);
    await expect(bar(page).getByRole("button", { name: /^Alerts/ })).toHaveCount(0);
    await expect(bar(page).getByRole("link", { name: /^Alerts/ })).toHaveCount(0);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });

  test("an old alert still opens a page", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    await makeOffer(world);
    await world.buyerPage.getByRole("main").getByRole("button", { name: /withdraw/i }).click();
    await expect(world.buyerPage.getByRole("main").getByText(/withdrawn/i).first()).toBeVisible();

    const page = world.officerPage;
    await clickNav(page, "Offers");
    await bell(page, /^Alerts, \d+ unread$/).click();
    const response = page.waitForResponse((r) => /\/officer\/offers\/[^/]+$/.test(r.url()) || r.url().includes("/alerts"));
    await bar(page).getByRole("button", { name: /New offer for 10/ }).click();
    expect((await response).status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/officer\/offers\/[^/]+$/);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
