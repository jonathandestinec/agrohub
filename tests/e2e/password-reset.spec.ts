import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { totp } from "./totp";

type OutboxMessage = { to: string; subject: string; html: string };

const password = "correct-horse-battery-staple";
const newPassword = "a-brand-new-passphrase-2026";
const HOME = /:3100\/$/;

function uniqueEmail(): string {
  return `e2e-reset-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function outboxFor(request: APIRequestContext, email: string): Promise<OutboxMessage[]> {
  const response = await request.get("/api/dev/outbox");
  expect(response.status()).toBe(200);
  return ((await response.json()) as OutboxMessage[]).filter((m) => m.to === email);
}

// The newest message to `email` whose subject matches, with its first link.
async function linkFrom(request: APIRequestContext, email: string, subject: RegExp): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const message = (await outboxFor(request, email)).filter((m) => subject.test(m.subject)).at(-1);
      link = message?.html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function signUpAndVerify(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Amina Bello");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Phone number").fill("+2348012345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await linkFrom(request, email, /Verify/));
  await expect(page).toHaveURL(/\/verified$/);
}

async function signIn(page: Page, email: string, pw: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function requestReset(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test("forgot password: request, open the emailed link, set a new password, sign in with it", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail();
  await signUpAndVerify(page, request, email);

  await requestReset(page, email);
  const link = await linkFrom(request, email, /Reset your AgroHub password/);

  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

  // The old password no longer works; the new one does.
  await signIn(page, email, password);
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
  await signIn(page, email, newPassword);
  await expect(page).toHaveURL(HOME);

  // The same link cannot be used twice.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "This link did not work" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get a new link" })).toBeVisible();
});

test("an unknown address gets the same confirmation and no email", async ({ page, request }) => {
  const email = uniqueEmail();
  await requestReset(page, email);
  await expect(page.getByText(`If an account exists for ${email}`)).toBeVisible();
  // Give a (wrongly) sent email time to land before asserting there is none.
  await page.waitForTimeout(1_500);
  expect(await outboxFor(request, email)).toHaveLength(0);
});

test("a garbage reset token shows the expired message and offers a new request", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(page.getByRole("heading", { name: "This link did not work" })).toBeVisible();
  await page.getByRole("link", { name: "Get a new link" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test("resetting the password does not bypass two-factor at the next sign-in", async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = uniqueEmail();
  await signUpAndVerify(page, request, email);
  await signIn(page, email, password);
  await expect(page.getByRole("button", { name: /^Account:/ })).toBeVisible();

  await page.goto("/two-factor");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Get setup key" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(HOME);

  await requestReset(page, email);
  await page.goto(await linkFrom(request, email, /Reset your AgroHub password/));
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

  await signIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/two-factor$/);
});
