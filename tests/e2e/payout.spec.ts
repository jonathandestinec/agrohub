import { expect, test, type Page } from "@playwright/test";
import { grantRole } from "./grant";
import { clickNav, completeSignUp, enrolTwoFactor, HOME, LANDING, newPage, signIn, uniqueEmail, uniqueTag } from "./journey";
import { setUpLotWorld } from "./lot-world";

// Phase 5b: a buyer pays for 10 bags; the officer prepares, proposes a date and marks 8 of 10
// delivered; the buyer confirms the lower quantity (₦130,000 back), the receipt shows the
// refund, and the farmer's statement shows the take-home, then "Paid" once the payouts run
// (a dev-only trigger stands in for the next day's job). A second order: the buyer reports a
// problem and an admin refunds it in full.

async function expectNoEscrow(page: Page) {
  expect((await page.getByRole("main").innerText()).toLowerCase()).not.toContain("escrow");
}

async function buy(page: Page, lotUrl: string, unit: string, quantity: string) {
  await page.goto(lotUrl);
  const main = page.getByRole("main");
  await main.getByLabel(`Quantity to buy (${unit})`).fill(quantity);
  await main.getByRole("button", { name: "Pay with Paystack" }).click();
  await expect(page.getByRole("heading", { name: "Test checkout" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Pay (test)" }).click();
  await expect(page).toHaveURL(/\/buyer\/orders\//);
  await expect(main.getByText("Paid, held until delivery is confirmed")).toBeVisible();
  return page.url();
}

test("delivery, a shortfall, confirmation, payouts and an admin refund", async ({ browser, request }) => {
  test.setTimeout(420_000);
  const tag = uniqueTag();
  const cooperative = `Delivery ${tag} Cooperative`;
  const crop = `Sorghum ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("po-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("po-farmer") };
  const buyer = { name: `Ada ${tag}`, email: uniqueEmail("po-buyer") };
  const admin = { name: "Admin Bisi", email: uniqueEmail("po-admin") };

  const officerPage = await newPage(browser);
  const buyerPage = await newPage(browser);
  const farmerPage = await newPage(browser);
  const adminPage = await newPage(browser);
  let lotUrl = "";
  let orderUrl = "";
  let secondOrderUrl = "";

  await test.step("setup: a live lot of 30 bags at ₦65,000; everyone signs in", async () => {
    for (const path of ["/buyer/join", "/buyer/orders", "/buyer/orders/warm", "/buyer/orders/warm/receipt", "/lots/warm",
      "/officer/orders", "/officer/orders/warm", "/farmer/earnings", "/farmer/earnings/warm", "/admin/orders",
      "/admin/orders/warm", "/two-factor", "/dev/paystack/checkout?reference=warm"]) {
      await request.get(path, { timeout: 120_000 });
    }
    for (const user of [officer, farmer, admin]) {
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
      liveLot: { quantity: 30, askKobo: 6_500_000, floorKobo: 6_000_000, minOrderQty: 1 },
      cooperativeAccountName: cooperative.toUpperCase(),
    });
    await grantRole(admin.email, "ADMIN");
    await signIn(officerPage, officer.email);
    await expect(officerPage).toHaveURL(LANDING.officer);
    await signIn(farmerPage, farmer.email);
    await expect(farmerPage).toHaveURL(LANDING.farmer);
    await buyerPage.goto("/sign-up");
    await completeSignUp(buyerPage, request, buyer);
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
    lotUrl = buyerPage.url();
  });

  await test.step("1. the buyer buys 10 bags and pays", async () => {
    orderUrl = await buy(buyerPage, lotUrl, unit, "10");
    await expectNoEscrow(buyerPage);
  });

  await test.step("2. the officer prepares, proposes a date and marks 8 of 10 delivered", async () => {
    const page = officerPage;
    await clickNav(page, "Orders");
    const main = page.getByRole("main");
    await main.getByRole("listitem").filter({ hasText: crop }).first().getByRole("link").click();
    await expect(main.getByText(`Buyer: ${buyer.name}`, { exact: false })).toBeVisible();
    await main.getByRole("button", { name: "Start preparing" }).click();
    await expect(main.getByRole("button", { name: "Start preparing" })).toHaveCount(0);
    await main.getByRole("button", { name: "Propose this date" }).click();
    await expect(main.getByText(/Delivery date proposed:/)).toBeVisible();
    await main.getByLabel(`Quantity delivered (${unit})`).fill("8");
    await main.getByRole("button", { name: "Mark delivered" }).click();
    await expect(main.getByText(`Marked delivered: 8 of 10 ${unit}`).first()).toBeVisible();
  });

  await test.step("3. the buyer confirms 8 of 10 and sees the refund on the receipt", async () => {
    const page = buyerPage;
    await page.goto(orderUrl);
    const main = page.getByRole("main");
    await expect(main.getByText("8 of 10 delivered: confirming refunds ₦130,000.00 for the rest")).toBeVisible();
    await main.getByRole("button", { name: "Confirm I received it" }).click();
    await expect(main.getByText("Completed", { exact: true })).toBeVisible();
    await main.getByRole("link", { name: "Receipt" }).click();
    await expect(page.getByRole("heading", { name: /Receipt for order/ })).toBeVisible();
    await expect(main.getByText("Total paid: ₦650,000.00")).toBeVisible();
    await expect(main.getByText(/Refund: ₦130,000\.00 \(not delivered\)/)).toBeVisible();
    await expect(main.getByText("Net paid: ₦520,000.00")).toBeVisible();
    await expectNoEscrow(page);
  });

  await test.step("4. the farmer's statement shows the take-home, waiting, then paid", async () => {
    const page = farmerPage;
    await clickNav(page, "Earnings");
    const main = page.getByRole("main");
    // 8 × ₦65,000 = ₦520,000, less the cut (the lot world's cooperative cut) and the 3% fee.
    await main.getByRole("listitem").filter({ hasText: crop }).getByRole("link").click();
    await expect(main.getByText(/Your take-home: ₦/)).toBeVisible();
    await expect(main.getByText("Waiting", { exact: true }).first()).toBeVisible();
    const orderId = orderUrl.split("/buyer/orders/")[1];
    const run = await request.post(`/api/dev/paystack/run-payouts?orderId=${orderId}`);
    expect(run.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("main").getByText("Paid", { exact: true }).first()).toBeVisible();
  });

  await test.step("5. a second order: the buyer reports a problem", async () => {
    secondOrderUrl = await buy(buyerPage, lotUrl, unit, "5");
    const main = buyerPage.getByRole("main");
    await main.getByLabel("What went wrong").fill(`The cooperative stopped answering ${tag}`);
    await main.getByRole("button", { name: "Report the problem" }).click();
    await expect(main.getByText("With AgroHub for review")).toBeVisible();
  });

  await test.step("6. an admin with two-factor refunds it in full", async () => {
    const page = adminPage;
    await signIn(page, admin.email);
    // An admin without two-factor is sent to enrol before the queue opens.
    await expect(page).toHaveURL(LANDING.twoFactor);
    await enrolTwoFactor(page);
    await clickNav(page, "Order queue");
    await expect(page.getByRole("heading", { name: "Order queue" })).toBeVisible();
    const main = page.getByRole("main");
    await main.getByRole("link").filter({ hasText: `The cooperative stopped answering ${tag}` }).click();
    await main.getByRole("radio", { name: "Refund the buyer in full" }).check();
    await main.getByLabel("Note (kept with the decision)").fill("No answer from the cooperative for a week.");
    await main.getByRole("button", { name: "Decide" }).click();
    await expect(main.getByText(/Decided: Refund the buyer in full/)).toBeVisible({ timeout: 60_000 });
  });

  await test.step("7. the buyer sees Refunded", async () => {
    await buyerPage.goto(secondOrderUrl);
    await expect(buyerPage.getByRole("main").getByText("Refunded", { exact: true })).toBeVisible();
    await expectNoEscrow(buyerPage);
  });
});
