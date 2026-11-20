import { expect, test } from "@playwright/test";
import { clickNav } from "./journey";
import { bar, bell, makeOffer, startWorld, writeToCooperative } from "./alerts-world";

// Pages update by themselves while they are open: one person acts, another person's page changes
// with no reload. Each page is marked before the action; if it were reloaded the mark would be
// gone. The polling is real (5 s in a thread, 15 s on an order or offer, 30 s for the bell), so the
// waits below are longer than an interval plus a page fetch.

const LIVE = { timeout: 60_000 };

test.describe("live updates", () => {
  test.setTimeout(600_000);

  test("a message, an alert, an offer answer and an order step all arrive without a reload", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const { buyerPage, officerPage } = world;
    const lotUrl = buyerPage.url();
    const mark = async (page: typeof buyerPage, value: string) => page.evaluate((v) => ((window as unknown as { __live: string }).__live = v), value);
    const marked = async (page: typeof buyerPage) => page.evaluate(() => (window as unknown as { __live?: string }).__live);

    await test.step("the officer's bell shows a new offer with no click and no navigation", async () => {
      await expect(bell(officerPage, "Alerts, none unread")).toBeVisible();
      await mark(officerPage, "officer");
      await makeOffer(world);
      await expect(bell(officerPage, "Alerts, 1 unread")).toBeVisible(LIVE);
      expect(await marked(officerPage)).toBe("officer");
    });

    await test.step("a message appears in the other person's open thread, and a half-typed reply survives", async () => {
      await writeToCooperative(buyerPage, "Is the maize dry?");
      await clickNav(officerPage, "Messages");
      await officerPage.getByRole("main").getByRole("link", { name: new RegExp(world.buyerName) }).click();
      await expect(officerPage).toHaveURL(/\/messages\/[^/]+$/);
      // Opening the thread reads its message alert: the offer alert is the only one left.
      await expect(bell(officerPage, "Alerts, 1 unread")).toBeVisible(LIVE);

      const draft = "I am still typing this";
      await buyerPage.getByRole("main").getByLabel("Your message").fill(draft);
      await mark(buyerPage, "buyer");
      const reply = officerPage.getByRole("main");
      await reply.getByLabel("Your message").fill("Yes, it is dry.");
      await reply.getByRole("button", { name: "Send", exact: true }).click();
      await expect(reply.getByText("Yes, it is dry.")).toBeVisible();

      await expect(buyerPage.getByRole("main").getByText("Yes, it is dry.")).toBeVisible(LIVE);
      await expect(buyerPage.getByRole("main").getByLabel("Your message")).toHaveValue(draft);
      expect(await marked(buyerPage)).toBe("buyer");
      // The buyer's page showed the thread, so the message alert it raised is read too.
      await expect(bell(buyerPage, "Alerts, none unread")).toBeVisible(LIVE);
    });

    await test.step("the officer answers the offer and the buyer's open offer page changes", async () => {
      await clickNav(officerPage, "Offers");
      await expect(officerPage).toHaveURL(/\/officer\/offers$/);
      await officerPage.locator('main a[href^="/officer/offers/"]').first().click();
      await expect(officerPage).toHaveURL(/\/officer\/offers\/[^/]+$/);
      // The buyer is on the offer page (not the thread) while the officer answers.
      await buyerPage.goto("/buyer/offers");
      await buyerPage.locator('main a[href^="/buyer/offers/"]').first().click();
      await expect(buyerPage).toHaveURL(/\/buyer\/offers\/[^/]+$/);
      await mark(buyerPage, "offer-page");
      await officerPage.getByRole("main").getByRole("button", { name: "Reject" }).click();
      await expect(buyerPage.getByRole("main").getByText(/declined/i).first()).toBeVisible(LIVE);
      expect(await marked(buyerPage)).toBe("offer-page");
    });

    await test.step("the officer starts preparing and the buyer's open order page changes", async () => {
      await buyerPage.goto(lotUrl);
      const main = buyerPage.getByRole("main");
      await main.getByLabel(new RegExp("^Quantity to buy")).fill("10");
      await main.getByRole("button", { name: "Pay with Paystack" }).click();
      await expect(buyerPage.getByRole("heading", { name: "Test checkout" })).toBeVisible();
      await buyerPage.getByRole("main").getByRole("button", { name: "Pay (test)" }).click();
      await expect(buyerPage).toHaveURL(/\/buyer\/orders\//);
      await expect(buyerPage.getByRole("main").getByText("Paid, held until delivery is confirmed")).toBeVisible();

      await clickNav(officerPage, "Orders");
      await expect(officerPage).toHaveURL(/\/officer\/orders$/);
      await officerPage.locator('main a[href^="/officer/orders/"]').first().click();
      await expect(officerPage).toHaveURL(/\/officer\/orders\/[^/]+$/);
      await mark(buyerPage, "order-page");
      await officerPage.getByRole("main").getByRole("button", { name: "Start preparing" }).click();
      await expect(buyerPage.getByRole("main").getByText("Being prepared")).toBeVisible(LIVE);
      expect(await marked(buyerPage)).toBe("order-page");
    });
  });

  test("on a phone the bell badge updates by itself", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const page = world.officerPage;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/officer/orders");
    await expect(bar(page).getByRole("link", { name: "Alerts, none unread" })).toBeVisible();
    await makeOffer(world);
    await expect(bar(page).getByRole("link", { name: "Alerts, 1 unread" })).toBeVisible(LIVE);
  });

  test("a hidden tab asks for nothing and one request is made when it comes back", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const page = world.officerPage;
    const posts: number[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/live") && r.method() === "POST") posts.push(Date.now());
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(40_000);
    expect(posts).toHaveLength(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
  });
});
