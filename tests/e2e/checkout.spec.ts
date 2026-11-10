import { expect, test, type Page } from "@playwright/test";
import { clickNav, completeSignUp, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// Phase 5a: a buyer asks for delivery, the officer quotes it in the thread, the buyer buys 10
// bags with that delivery and pays on the local test checkout page (the fake Paystack, whose
// signed webhook goes through the real handler). The order reads "Paid, held until delivery is
// confirmed" and the cooperative sees it. The same buyer then pays an accepted offer. No page
// ever calls the held payment escrow.

async function expectNoEscrow(page: Page) {
  expect((await page.getByRole("main").innerText()).toLowerCase()).not.toContain("escrow");
}

test("a buyer pays for a lot with a quoted delivery cost, and pays an accepted offer", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const tag = uniqueTag();
  const cooperative = `Harvest ${tag} Cooperative`;
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("pay-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("pay-farmer") };
  const buyer = { name: `Ada ${tag}`, email: uniqueEmail("pay-buyer") };

  const officerPage = await newPage(browser);
  const buyerPage = await newPage(browser);
  let lotUrl = "";

  await test.step("setup: a verified cooperative has a live lot; officer and buyer sign in", async () => {
    // next dev compiles each route on its first visit; warm the ones this journey opens.
    for (const path of ["/buyer/join", "/buyer", "/buyer/offers/warm", "/buyer/orders", "/buyer/orders/warm", "/lots",
      "/lots/warm", "/officer/offers", "/officer/offers/warm", "/officer/orders", "/officer/orders/warm", "/messages",
      "/messages/warm", "/dev/paystack/checkout?reference=warm"]) {
      await request.get(path, { timeout: 120_000 });
    }
    for (const user of [officer, farmer]) {
      const page = await newPage(browser);
      await page.goto("/sign-up");
      await completeSignUp(page, request, user);
      await page.close();
    }
    await setUpLotWorld({
      tag,
      cooperative,
      crop,
      unit,
      officerEmail: officer.email,
      farmerEmail: farmer.email,
      liveLot: { quantity: 30, askKobo: 6_500_000, floorKobo: 6_000_000, minOrderQty: 5 },
    });
    await signIn(officerPage, officer.email);
    await expect(officerPage).toHaveURL(LANDING.officer);
    await buyerPage.goto("/sign-up");
    await completeSignUp(buyerPage, request, buyer);
    await signIn(buyerPage, buyer.email);
    await expect(buyerPage).toHaveURL(HOME);
    await clickNav(buyerPage, "Buy produce");
    await buyerPage.getByRole("main").getByRole("button", { name: "Start buying" }).click();
    await expect(buyerPage.getByRole("heading", { name: "My offers" })).toBeVisible();
  });

  await test.step("1. the buyer opens the lot and asks for delivery", async () => {
    const page = buyerPage;
    await clickNav(page, "Browse lots");
    const main = page.getByRole("main");
    await main.getByLabel("Crop").selectOption({ label: crop });
    await main.getByRole("button", { name: "Show lots" }).click();
    await main.getByRole("listitem").filter({ hasText: crop }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
    lotUrl = page.url();
    await expect(main.getByText(`30 ${unit} available now`)).toBeVisible();
    await expect(main.getByText("For delivery, message the cooperative and ask for a delivery quote.")).toBeVisible();
    await main.getByRole("button", { name: "Message the cooperative" }).click();
    await main.getByLabel("Your message").fill("Can you deliver to Ibadan?");
    await main.getByRole("button", { name: "Send" }).click();
    await expect(main.getByText("Can you deliver to Ibadan?")).toBeVisible();
  });

  await test.step("2. the officer quotes ₦25,000 for delivery in the thread", async () => {
    const page = officerPage;
    await clickNav(page, "Messages");
    const main = page.getByRole("main");
    await main.getByRole("link", { name: new RegExp(buyer.name) }).click();
    await expect(main.getByText("Can you deliver to Ibadan?")).toBeVisible();
    await main.getByLabel("Delivery cost (₦)").fill("25000");
    await main.getByLabel("Note for the buyer (optional)").fill("By truck, two days");
    await main.getByRole("button", { name: "Send quote" }).click();
    await expect(main.getByText("Quote sent.")).toBeVisible();
    await expect(main.getByText(/Delivery quote: ₦25,000\.00, valid until/)).toBeVisible();
  });

  await test.step("3. the buyer buys 10 with delivery and pays on the test checkout", async () => {
    const page = buyerPage;
    await page.goto(lotUrl);
    const main = page.getByRole("main");
    await main.getByLabel(`Quantity to buy (${unit})`).fill("10");
    await main.getByRole("radio", { name: /Delivery, ₦25,000\.00/ }).check();
    await expect(main.getByText("You pay ₦675,000.00")).toBeVisible();
    await expect(
      main.getByText("Your payment is held until delivery is confirmed. Then AgroHub pays the cooperative and its farmers."),
    ).toBeVisible();
    await expectNoEscrow(page);
    await main.getByRole("button", { name: "Pay with Paystack" }).click();
    await expect(page.getByRole("heading", { name: "Test checkout" })).toBeVisible();
    await expect(page.getByRole("main").getByText("Amount: ₦675,000.00")).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Pay (test)" }).click();
    await expect(page).toHaveURL(/\/buyer\/orders\//);
    await expect(main.getByText("Paid, held until delivery is confirmed")).toBeVisible();
    await expect(main.getByText("Total paid: ₦675,000.00")).toBeVisible();
    await expect(main.getByText("Delivery: ₦25,000.00")).toBeVisible();
    await expectNoEscrow(page);
    await page.goto(lotUrl);
    await expect(main.getByText(`20 ${unit} available now`)).toBeVisible();
  });

  await test.step("4. the officer sees the paid order with the buyer's name", async () => {
    const page = officerPage;
    await clickNav(page, "Orders");
    const main = page.getByRole("main");
    const card = main.getByRole("listitem").filter({ hasText: crop });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`Buyer: ${buyer.name}`);
    await expect(card).toContainText("Paid, to prepare");
    await card.getByRole("link").click();
    await expect(main.getByText("Delivery (kept by the cooperative): ₦25,000.00")).toBeVisible();
    await expect(main.getByText(`Musa ${tag}: 30 ${unit}`, { exact: false })).toBeVisible();
  });

  await test.step("5. the buyer pays an accepted offer", async () => {
    const page = buyerPage;
    const main = page.getByRole("main");
    await page.goto(lotUrl);
    await main.getByLabel(`Quantity (${unit})`).fill("5");
    await main.getByLabel(`Your price per ${unit} (₦)`).fill("64000");
    await main.getByRole("button", { name: "Make offer" }).click();
    await expect(main.getByText("Waiting for the cooperative")).toBeVisible();
    const offerUrl = page.url();

    await clickNav(officerPage, "Offers");
    const officerMain = officerPage.getByRole("main");
    await officerMain.getByRole("listitem").filter({ hasText: "Waiting for you" }).getByRole("link").click();
    await officerMain.getByRole("button", { name: "Accept offer" }).click();
    await expect(officerMain.getByText("Accepted", { exact: true })).toBeVisible();

    await page.goto(offerUrl);
    await expect(main.getByText("Accepted", { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Pay with Paystack" }).click();
    await expect(page.getByRole("main").getByText("Amount: ₦320,000.00")).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Pay (test)" }).click();
    await expect(main.getByText("Paid, held until delivery is confirmed")).toBeVisible();
    await page.goto(offerUrl);
    await expect(main.getByText("Paid", { exact: true })).toBeVisible();
    await clickNav(page, "My orders");
    await expect(main.getByRole("listitem")).toHaveCount(2);
  });
});
