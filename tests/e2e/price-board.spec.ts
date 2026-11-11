import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { grantRole } from "./grant";
import { totp } from "./totp";

// Phase 2: a board admin, granted in setup, enrols two-factor, adds a crop and a unit,
// records a weekly price, and a signed-out visitor reads it on the public board.

type OutboxMessage = { to: string; subject: string; html: string };

const password = "correct-horse-battery-staple";

// Letters only: crop and unit names are unique across runs on the shared test database.
function uniqueTag(): string {
  return Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}

async function linkFromOutbox(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get("/api/dev/outbox");
      const sent = (await response.json()) as OutboxMessage[];
      link = sent
        .filter((m) => m.to === email)
        .at(-1)
        ?.html.match(/href="([^"]+)"/)?.[1]
        ?.replace(/&amp;/g, "&");
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function clickNav(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
}

test("a board admin records a price and a visitor sees it on the board", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const tag = uniqueTag();
  const crop = `Maize ${tag}`;
  const unit = `Bag ${tag}`;
  const email = `e2e-board-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  await test.step("sign up, be granted board admin and enrol two-factor", async () => {
    await page.goto("/sign-up");
    await page.getByLabel("Full name").fill("Board Admin");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Phone number").fill("+2348012345678");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();
    await page.goto(await linkFromOutbox(request, email));
    await grantRole(email, "BOARD_ADMIN");

    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // A board admin without two-factor lands on /board, which sends them to enrol first.
    await expect(page).toHaveURL(/\/two-factor$/);
    await expect(
      page.getByRole("heading", { name: "Set up two-factor authentication" }),
    ).toBeVisible();
    await page.getByLabel("Password").fill(password);
    // The button stays disabled until the page has hydrated, after the full load from sign-in.
    const setupKey = page.getByRole("button", { name: "Get setup key" });
    await expect(setupKey).toBeEnabled();
    await setupKey.click();
    const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    // Verifying sends the board admin to the price entry page; wait for it before using the nav.
    await expect(page).toHaveURL(/\/board$/);
  });

  await test.step("add a crop and a unit", async () => {
    await clickNav(page, "Crops and units");
    await expect(page.getByRole("heading", { name: "Crops and units" })).toBeVisible();
    await page.getByLabel("New crop").fill(crop);
    await page.getByRole("button", { name: "Add crop" }).click();
    await expect(page.getByRole("list", { name: "Crops" }).getByText(crop)).toBeVisible();
    await page.getByLabel("New unit").fill(unit);
    await page.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByRole("list", { name: "Units" }).getByText(unit)).toBeVisible();
    // The same name again, in another case, is refused.
    await page.getByLabel("New crop").fill(crop.toLowerCase());
    await page.getByRole("button", { name: "Add crop" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "A crop with this name already exists." }),
    ).toBeVisible();
  });

  await test.step("record this week's price", async () => {
    await clickNav(page, "Price entry");
    await expect(page.getByRole("heading", { name: "Price entry" })).toBeVisible();
    // Earlier pages stay in the DOM, hidden; getByRole skips hidden ones, so scope to main.
    const main = page.getByRole("main");
    await main.getByLabel("Crop", { exact: true }).selectOption({ label: crop });
    await main.getByLabel("Unit", { exact: true }).selectOption({ label: unit });
    await main.getByLabel("Market", { exact: true }).fill("Bodija Market");
    await main.getByLabel("Price (₦)").fill("52000");
    await main.getByRole("button", { name: "Save price" }).click();
    const row = main.getByRole("row", { name: new RegExp(tag) });
    await expect(row).toContainText("Bodija Market");
    await expect(row).toContainText("₦52,000.00");
  });

  await test.step("a signed-out visitor reads it on the price board", async () => {
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto("/prices");
    await expect(visitor.getByRole("heading", { name: "Price board" })).toBeVisible();
    await visitor.getByRole("main").getByLabel("Crop", { exact: true }).selectOption({ label: crop });
    await visitor.getByRole("button", { name: "Show" }).click();
    const row = visitor.getByRole("row", { name: new RegExp(tag) });
    await expect(row).toContainText("₦52,000.00");
    await expect(row).toContainText("No earlier price");
  });
});
