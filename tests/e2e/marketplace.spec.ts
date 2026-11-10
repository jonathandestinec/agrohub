import { expect, test, type Page } from "@playwright/test";
import { clickNav, completeSignUp, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// Phase 4: a new buyer signs up, finds a live lot with the filters, and negotiates two offers to
// acceptance: one below the floor that the farmer agrees to, and one through a counter. No
// buyer page ever shows the farmer's private lowest price (₦43,219.87).

async function expectNoFloor(page: Page) {
  const text = (await page.content()) + (await page.getByRole("main").innerText());
  expect(text).not.toContain("43,219.87");
  expect(text).not.toContain("43219.87");
  expect(text).not.toContain("4321987");
}

test("a buyer negotiates a lot to an accepted offer without ever seeing the floor", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const tag = uniqueTag();
  const cooperative = `Harvest ${tag} Cooperative`;
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("mkt-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("mkt-farmer") };
  const buyer = { name: `Ada ${tag}`, email: uniqueEmail("mkt-buyer") };

  const officerPage = await newPage(browser);
  const farmerPage = await newPage(browser);
  const buyerPage = await newPage(browser);

  await test.step("setup: officer and farmer sign up; a verified cooperative has a live lot", async () => {
    // next dev compiles each route on its first visit; warm the ones this journey opens so a
    // first compile does not eat an assertion's timeout.
    for (const path of ["/buyer/join", "/buyer", "/buyer/offers/warm", "/lots", "/lots/warm", "/cooperatives/warm",
      "/officer/offers", "/officer/offers/warm", "/farmer/lots", "/farmer/lots/warm", "/messages", "/messages/warm"]) {
      await request.get(path, { timeout: 120_000 });
    }
    for (const [page, user] of [
      [officerPage, officer],
      [farmerPage, farmer],
    ] as const) {
      await page.goto("/sign-up");
      await completeSignUp(page, request, user);
    }
    await setUpLotWorld({
      tag,
      cooperative,
      crop,
      unit,
      officerEmail: officer.email,
      farmerEmail: farmer.email,
      liveLot: { quantity: 30, askKobo: 6_500_000, floorKobo: 4_321_987, minOrderQty: 5 },
    });
    for (const [page, user, landing] of [
      [officerPage, officer, LANDING.officer],
      [farmerPage, farmer, LANDING.farmer],
    ] as const) {
      await signIn(page, user.email);
      await expect(page).toHaveURL(landing);
    }
  });

  await test.step("1. a new user signs up and starts buying", async () => {
    const page = buyerPage;
    await page.goto("/sign-up");
    await completeSignUp(page, request, buyer);
    await signIn(page, buyer.email);
    await expect(page).toHaveURL(HOME);
    await clickNav(page, "Buy produce");
    await expect(page.getByRole("heading", { name: "Buy from verified cooperatives" })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Start buying" }).click();
    await expect(page.getByRole("heading", { name: "My offers" })).toBeVisible();
  });

  await test.step("2. the buyer filters the lots, opens the lot and its cooperative", async () => {
    const page = buyerPage;
    await clickNav(page, "Browse lots");
    const main = page.getByRole("main");
    await main.getByLabel("Crop").selectOption({ label: crop });
    await main.getByLabel("Grade").selectOption({ label: "Grade A" });
    await main.getByRole("button", { name: "Show lots" }).click();
    await expect(page).toHaveURL(/grade=A/);
    const card = main.getByRole("listitem").filter({ hasText: crop });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`₦65,000.00 per ${unit}`);
    await expectNoFloor(page);
    await card.getByRole("link").click();
    await expect(page.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
    await expectNoFloor(page);
    await page.getByRole("main").getByRole("link", { name: cooperative }).click();
    await expect(page.getByRole("heading", { name: cooperative })).toBeVisible();
    await expect(page.getByRole("main").getByText("Verified since")).toBeVisible();
    await expectNoFloor(page);
    await page.goBack();
    await expect(page.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
  });

  await test.step("3. the buyer offers below the floor, with a note", async () => {
    const page = buyerPage;
    const main = page.getByRole("main");
    await main.getByLabel(`Quantity (${unit})`).fill("10");
    await main.getByLabel(`Your price per ${unit} (₦)`).fill("40000");
    await expect(main.getByText("You offer ₦400,000.00 in total")).toBeVisible();
    await main.getByLabel("Message to the cooperative (optional)").fill("Can you deliver to Ibadan?");
    await main.getByRole("button", { name: "Make offer" }).click();
    await expect(page.getByRole("heading", { name: `10 × ${unit} of ${crop}` })).toBeVisible();
    await expect(main.getByText("Waiting for the cooperative")).toBeVisible();
    await expect(main.getByText("Can you deliver to Ibadan?")).toBeVisible();
    await expectNoFloor(page);
  });

  await test.step("4. a phone number in a message is refused", async () => {
    const main = buyerPage.getByRole("main");
    await main.getByLabel("Your message").fill("call 08031234567");
    await main.getByRole("button", { name: "Send" }).click();
    await expect(main.getByRole("alert")).toContainText("Phone numbers and email addresses can't be shared");
  });

  await test.step("5. the officer sees the floor and sends the offer to the farmer", async () => {
    const page = officerPage;
    await clickNav(page, "Offers");
    const main = page.getByRole("main");
    const card = main.getByRole("listitem").filter({ hasText: crop });
    await expect(card).toContainText("Below the farmer's lowest price");
    await expect(card).toContainText(`From ${buyer.name}`);
    await card.getByRole("link").click();
    await expect(main.getByText("Farmer's lowest price, private: ₦43,219.87")).toBeVisible();
    await expect(main.getByText("Can you deliver to Ibadan?")).toBeVisible();
    await main.getByRole("button", { name: "Send to the farmer to agree" }).click();
    await expect(main.getByText("With the farmer", { exact: true })).toBeVisible();
  });

  await test.step("6. the buyer still sees the offer as waiting", async () => {
    await buyerPage.reload();
    await expect(buyerPage.getByRole("main").getByText("Waiting for the cooperative")).toBeVisible();
    await expectNoFloor(buyerPage);
  });

  await test.step("7. the farmer sees their take-home and agrees", async () => {
    const page = farmerPage;
    await clickNav(page, "My lots");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Offers waiting for you" })).toBeVisible();
    await main.getByRole("link", { name: new RegExp(`10 × ${unit} of ${crop} at ₦40,000.00`) }).click();
    await expect(main.getByRole("heading", { name: `A buyer offers ₦40,000.00 per ${unit} for 10` })).toBeVisible();
    await expect(main.getByText(buyer.name)).toHaveCount(0);
    await main.getByRole("button", { name: "Agree to this offer" }).click();
    await expect(main.getByRole("button", { name: "Agree to this offer" })).toHaveCount(0);
  });

  await test.step("8. the buyer sees the offer accepted", async () => {
    await buyerPage.reload();
    const main = buyerPage.getByRole("main");
    await expect(main.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(main.getByText(`Agreed price: ₦40,000.00 per ${unit}`)).toBeVisible();
    await expectNoFloor(buyerPage);
  });

  await test.step("9. a second offer is countered and the buyer accepts the counter", async () => {
    const buyerMain = buyerPage.getByRole("main");
    await buyerMain.getByRole("link", { name: "View the lot" }).click();
    await buyerMain.getByLabel(`Quantity (${unit})`).fill("10");
    await buyerMain.getByLabel(`Your price per ${unit} (₦)`).fill("42000");
    await buyerMain.getByRole("button", { name: "Make offer" }).click();
    await expect(buyerMain.getByText("Waiting for the cooperative")).toBeVisible();

    const officerMain = officerPage.getByRole("main");
    await clickNav(officerPage, "Offers");
    await officerMain.getByRole("listitem").filter({ hasText: "Waiting for you" }).getByRole("link").click();
    await officerMain.getByLabel("Counter price per unit (₦)").fill("50000");
    await officerMain.getByRole("button", { name: "Counter", exact: true }).click();
    await expect(officerMain.getByText("Countered", { exact: true })).toBeVisible();

    await buyerPage.reload();
    await expect(buyerMain.getByText(`The cooperative's counter: ₦50,000.00 per ${unit}`)).toBeVisible();
    await expectNoFloor(buyerPage);
    await buyerMain.getByRole("button", { name: "Accept counter" }).click();
    await expect(buyerMain.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(buyerMain.getByText(`Agreed price: ₦50,000.00 per ${unit}`)).toBeVisible();
    await expectNoFloor(buyerPage);
  });
});
