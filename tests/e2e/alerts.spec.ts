import { expect, test } from "@playwright/test";
import { clickNav, completeSignUp, newPage, uniqueEmail } from "./journey";
import { bar, bell, makeOffer, startWorld, writeToCooperative } from "./alerts-world";

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

    await test.step("opening the offer alert lands on the offer and the count drops to none", async () => {
      await bell(page, "Alerts, 2 unread").click();
      await bar(page).getByRole("button", { name: /New offer for 10/ }).click();
      await expect(page).toHaveURL(/\/officer\/offers\/[^/]+$/);
      // The offer page shows the buyer's thread, so opening it reads the message alert too.
      await expect(bell(page, "Alerts, none unread")).toBeVisible();
    });

    await test.step("Mark all as read clears a new alert", async () => {
      // Leave the offer page (which would read a new message at once), then the buyer writes again.
      await clickNav(page, "Orders");
      await expect(page).toHaveURL(/\/officer\/orders$/);
      await writeToCooperative(world.buyerPage, "Is the delivery date fixed?");
      await clickNav(page, "Messages");
      await expect(bell(page, "Alerts, 1 unread")).toBeVisible();
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

    await test.step("opening a thread reads its message alert, and an offer alert still opens its page", async () => {
      await clickNav(page, "Messages");
      await page.getByRole("main").getByRole("link", { name: new RegExp(world.buyerName) }).click();
      await expect(page).toHaveURL(/\/messages\/[^/]+$/);
      const here = page.url();
      // Opening the thread reads its message alert, so only the offer alert is left.
      await expect(bell(page, "Alerts, 1 unread")).toBeVisible();
      await bell(page, "Alerts, 1 unread").click();
      await bar(page).getByRole("button", { name: /New offer for 10/ }).click();
      await expect(page).toHaveURL(/\/officer\/offers\/[^/]+$/);
      await page.goBack();
      await expect(page).toHaveURL(here);
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
