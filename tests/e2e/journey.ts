import { expect, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { totp } from "./totp";

// Helpers shared by the end-to-end journeys. Each actor gets their own browser context, so
// their sessions never mix.

type OutboxMessage = { to: string; subject: string; html: string };

export const password = "correct-horse-battery-staple";
export const HOME = /:3100\/$/;
// Where each role lands after signing in without an explicit next (see landingPath).
export const LANDING = {
  admin: /\/admin\/orders$/,
  boardAdmin: /\/board$/,
  officer: /\/officer\/orders$/,
  officerOnboarding: /\/officer\/onboarding$/,
  farmer: /\/farmer$/,
  buyer: /\/lots$/,
  twoFactor: /\/two-factor$/,
} as const;

// Letters only, so it survives the bank-name match as one whole token.
export function uniqueTag(): string {
  return Array.from({ length: 8 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}

export function uniqueEmail(who: string): string {
  return `e2e-${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function linkFromOutbox(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get("/api/dev/outbox");
      expect(response.status()).toBe(200);
      const sent = (await response.json()) as OutboxMessage[];
      const message = sent.filter((m) => m.to === email).at(-1);
      link = message?.html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
      return link;
    })
    .toBeTruthy();
  return link!;
}

export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3100" });
  return context.newPage();
}

// Signs up from wherever the page is (the sign-up form is already open), then verifies
// the email through the fake outbox.
export async function completeSignUp(
  page: Page,
  request: APIRequestContext,
  user: { name: string; email: string },
) {
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Phone number").fill("+2348012345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await linkFromOutbox(request, user.email));
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await fillSignIn(page, email);
}

// Fills the sign-in form already on the page.
export async function fillSignIn(page: Page, email: string) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export function nav(page: Page, name: string): Locator {
  return page.getByRole("navigation").getByRole("link", { name, exact: true });
}

// The bar holds at most three items; some are groups that open a dropdown. Returns the nav
// link called `name`, opening the group that holds it first when it is not a top-level item.
// The group stays open so the caller can click or assert on the link.
export async function openNav(page: Page, name: string): Promise<Locator> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const link = nav(page, name);
  // The header streams in after the page body: wait for the bar to have something in it
  // before deciding whether the link is at the top level or inside a group.
  await page.getByRole("navigation").locator("a, button").first().waitFor({ state: "visible" });
  if (await link.isVisible()) return link;
  const groups = page.getByRole("navigation").locator("button[aria-expanded]");
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    await group.click();
    // The dropdown renders on the next tick (and a click before hydration is replayed late):
    // give the link a moment to show before moving on to the next group.
    const shown = await link.waitFor({ state: "visible", timeout: 1_500 }).then(
      () => true,
      () => false,
    );
    if (shown) return link;
    await group.click();
  }
  throw new Error(`No nav link called "${name}", at the top level or in a group`);
}

// The pinned nav narrows to a pill (links hidden and inert) while scrolled down, and comes
// back when the reader scrolls up; a person reaching for the nav scrolls up first, so do that.
export async function clickNav(page: Page, name: string) {
  await (await openNav(page, name)).click();
}

// The account button names who is signed in; its dropdown holds Profile and Sign out.
export function accountButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Account:/ });
}

export async function signOutFromMenu(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const account = accountButton(page);
  await expect(async () => {
    if ((await account.getAttribute("aria-expanded")) !== "true") await account.click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
}

// A tiny but valid PDF: the upload checks the %PDF magic bytes.
export const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

// Enrols TOTP on /two-factor, answering with a code computed from the setup key shown.
export async function enrolTwoFactor(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Set up two-factor authentication" }),
  ).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Get setup key" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  // Enrolled and signed in: on to the page the role lands on, away from /two-factor.
  await expect(page).not.toHaveURL(LANDING.twoFactor);
}
