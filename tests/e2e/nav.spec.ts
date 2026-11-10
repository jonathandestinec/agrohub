import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { grantAdmin } from "./grant";

type Box = { x: number; y: number; width: number; height: number };

// The pinned nav from the demo: it narrows while scrolling down and returns on scrolling up.
test("the nav narrows on scroll down and comes back on scroll up", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const bar = page.locator(".nav-bar");
  await expect(bar).not.toHaveAttribute("data-compact", /.*/);

  await page.mouse.move(400, 400);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 400);
      return bar.getAttribute("data-compact");
    })
    .not.toBeNull();
  await expect(bar).toHaveAttribute("data-scrolled", "");

  await page.mouse.wheel(0, -300);
  await expect(bar).not.toHaveAttribute("data-compact", /.*/);
  // Still pinned: the bar stays at the top of the screen.
  expect((await bar.boundingBox())!.y).toBeLessThan(40);
});

// With two memberships the header also carries the role switcher. Nothing in it may overlap
// at any width: not the wordmark, the links, the switcher, the account button nor the menu toggle.
type OutboxMessage = { to: string; subject: string; html: string };
const password = "correct-horse-battery-staple";

async function signUpOfficerWithAdmin(page: Page, request: APIRequestContext): Promise<void> {
  const email = `e2e-switcher-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Ngozi Okafor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Phone number").fill("+2348012345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  // The first sign-up compiles the auth routes under next dev, which can take a while.
  await expect(page.getByText("Check your email")).toBeVisible({ timeout: 30_000 });
  let link: string | undefined;
  await expect
    .poll(async () => {
      const sent = (await (await request.get("/api/dev/outbox")).json()) as OutboxMessage[];
      link = sent
        .filter((m) => m.to === email)
        .at(-1)
        ?.html.match(/href="([^"]+)"/)?.[1]
        ?.replace(/&amp;/g, "&");
      return link;
    })
    .toBeTruthy();
  await page.goto(link!);
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/:3100\/$/);

  // Registering a cooperative makes them its officer; the admin grant adds a second membership.
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
  await page.goto("/officer/onboarding");
  await page.getByLabel("Cooperative name").fill(`Header ${tag} Farmers Cooperative`);
  await page.getByLabel("Registration number").fill(`RC-${tag}`);
  await page.getByLabel("State").selectOption("Kaduna");
  await page.getByLabel("Local government area").fill("Zaria");
  await page.getByLabel("Certificate expiry date").fill("2030-01-01");
  await page.getByRole("button", { name: "Create cooperative" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await grantAdmin(email);
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Boxes of every visible control in the bar (or the open menu), each with a name for the message.
async function controlBoxes(scope: Locator): Promise<Array<{ name: string; box: Box }>> {
  const controls = scope.locator("a, button, select, label");
  const found: Array<{ name: string; box: Box }> = [];
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const name = (await control.textContent())?.trim() || (await control.getAttribute("aria-label")) || "";
    if (box && box.width > 0) found.push({ name, box });
  }
  return found;
}

function collisions(boxes: Array<{ name: string; box: Box }>): string[] {
  const hits: string[] = [];
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      if (overlaps(a.box, b.box)) hits.push(`${a.name} / ${b.name}`);
    }),
  );
  return hits;
}

test("with the role switcher shown, nothing in the header overlaps", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signUpOfficerWithAdmin(page, request);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // The admin role wins by default; act as the officer, whose three links are the widest row.
  const switched = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByLabel("Acting as").selectOption({ label: "Cooperative officer" });
  await switched;
  await page.reload();
  // The officer's bar: Cooperative and Selling groups, and the Messages link.
  await expect(page.locator('.nav-bar a[href="/messages"]')).toBeAttached();
  const cooperative = page.getByRole("navigation").getByRole("button", { name: "Cooperative", exact: true });
  await cooperative.click();
  await expect(cooperative).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Farmers", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cooperative).toHaveAttribute("aria-expanded", "false");
  await expect(cooperative).toBeFocused();

  // Who is signed in: initials (Ngozi Okafor) in the bar; name and role in the dropdown.
  const account = page.getByRole("button", { name: /^Account:/ });
  await expect(account).toHaveText("NO");
  await account.click();
  const panel = account.locator("xpath=..");
  await expect(panel.getByText("Ngozi Okafor", { exact: true })).toBeVisible();
  await expect(panel.getByText("Cooperative officer", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toHaveAttribute("aria-expanded", "false");

  for (const width of [1600, 1440, 1280, 1100, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const bar = page.locator(".nav-bar");
    expect(collisions(await controlBoxes(bar)), `bar at ${width}px`).toEqual([]);
    // Each control is fully inside the bar, never clipped by its rounded edge.
    const outer = (await bar.boundingBox())!;
    for (const { name, box } of await controlBoxes(bar)) {
      expect(box.x >= outer.x && box.x + box.width <= outer.x + outer.width, `${name} at ${width}px`).toBe(true);
    }

    const toggle = page.getByRole("button", { name: "Open menu" });
    if (await toggle.isVisible()) {
      await toggle.click();
      const menu = page.locator("#app-menu");
      await expect(menu.getByLabel("Acting as")).toBeVisible();
      // The menu's items slide in one after another; measure them where they come to rest.
      await menu.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      expect(collisions(await controlBoxes(menu)), `menu at ${width}px`).toEqual([]);
      await page.getByRole("button", { name: "Close menu" }).click();
    }
  }
});
