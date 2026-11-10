import { expect, test, type Page } from "@playwright/test";
import {
  clickNav,
  completeSignUp,
  LANDING,
  newPage,
  signIn,
  uniqueEmail,
  uniqueTag,
} from "./journey";
import { setUpLotWorld } from "./lot-world";

// Phase 3: a farmer lists a lot, sees their take-home, the officer screens it, it goes live
// with locked terms, and a signed-out visitor sees it on /lots without the private floor.

// A real JPEG drawn in the browser, so no binary fixture is committed.
async function jpegFrom(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#d9a520";
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#173a2a";
    context.fillRect(80, 60, 480, 360);
    return canvas.toDataURL("image/jpeg", 0.9);
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test("a farmer's lot goes live after officer approval, with locked terms and no floor in public", async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const tag = uniqueTag();
  const cooperative = `Harvest ${tag} Cooperative`;
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("lot-officer") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("lot-farmer") };

  const officerPage = await newPage(browser);
  const farmerPage = await newPage(browser);

  await test.step("setup: both sign up; the cooperative, membership, bank and board price are wired", async () => {
    for (const [page, user] of [
      [officerPage, officer],
      [farmerPage, farmer],
    ] as const) {
      await page.goto("/sign-up");
      await completeSignUp(page, request, user);
    }
    await setUpLotWorld({ tag, cooperative, crop, unit, officerEmail: officer.email, farmerEmail: farmer.email });
    for (const [page, user, landing] of [
      [officerPage, officer, LANDING.officer],
      [farmerPage, farmer, LANDING.farmer],
    ] as const) {
      await signIn(page, user.email);
      await expect(page).toHaveURL(landing);
    }
  });

  await test.step("1. the farmer fills the lot form and sees their take-home", async () => {
    const page = farmerPage;
    await clickNav(page, "My lots");
    await page.getByRole("main").getByRole("link", { name: "List a lot" }).click();
    await expect(page.getByRole("heading", { name: "List a lot" })).toBeVisible();
    const main = page.getByRole("main");
    await main.getByLabel("Crop").selectOption({ label: crop });
    await main.getByLabel("Unit", { exact: true }).selectOption({ label: unit });
    await main.getByLabel("Quantity").fill("30");
    await main.getByLabel("Asking price per unit (₦)").fill("65000");
    await main.getByLabel("Your lowest price per unit (₦)").fill("43219.87");
    await expect(main.getByText(`You take home per ${unit}`)).toBeVisible();
    // ₦65,000 less 5% (₦3,250) and 3% (₦1,950).
    await expect(main.getByText("₦59,800.00")).toBeVisible();
    await expect(main.getByText("Cooperative cut (5%)")).toBeVisible();
    await expect(main.getByText("AgroHub fee (3%)")).toBeVisible();
    // ₦65,000 is within 20% of the ₦60,000 board price: no warning.
    await expect(main.getByText(/well above the board prices/)).toHaveCount(0);

    await main.getByLabel("Add photos").setInputFiles({
      name: "maize.jpg",
      mimeType: "image/jpeg",
      buffer: await jpegFrom(page),
    });
    await expect(main.getByRole("img", { name: "Photo 1" })).toBeVisible();
    await main.getByRole("button", { name: "Send to my officer" }).click();
    await expect(page.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
    await expect(main.getByText("Waiting for screening")).toBeVisible();
  });

  await test.step("2. the officer sees the floor and approves with a minimum order", async () => {
    const page = officerPage;
    await clickNav(page, "Screen lots");
    const main = page.getByRole("main");
    await main.getByRole("link", { name: new RegExp(`30 × ${unit} of ${crop}`) }).click();
    await expect(page.getByRole("heading", { name: `30 × ${unit} of ${crop}` })).toBeVisible();
    await expect(main.getByText("₦43,219.87")).toBeVisible();
    await main.getByLabel(`Minimum order (${unit})`).fill("5");
    await main.getByRole("button", { name: "Approve and go live" }).click();
    await expect(main.getByText("Live", { exact: true }).first()).toBeVisible();
  });

  await test.step("3. the farmer sees the lot live with locked terms", async () => {
    const page = farmerPage;
    await page.reload();
    const main = page.getByRole("main");
    await expect(main.getByText("Buyers can see this lot at your asking price. Your terms are locked.")).toBeVisible();
    const terms = main
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Terms locked to this lot" }) });
    await expect(terms.getByText("Cooperative cut (5%)")).toBeVisible();
    await expect(terms.getByText("AgroHub fee (3%)")).toBeVisible();
  });

  await test.step("4. a signed-out visitor sees the lot on /lots, without the floor", async () => {
    const page = await newPage(browser);
    await page.goto("/lots");
    const main = page.getByRole("main");
    const card = main.getByRole("listitem").filter({ hasText: crop });
    await expect(card).toContainText(`₦65,000.00 per ${unit}`);
    await expect(card).toContainText(`Sold by ${cooperative}`);
    await expect(card).toContainText(`Minimum 5 × ${unit}`);
    const text = (await page.content()) + (await main.innerText());
    expect(text).not.toContain("43,219.87");
    expect(text).not.toContain("4321987");
    expect(text).not.toContain(farmer.name);
  });
});
