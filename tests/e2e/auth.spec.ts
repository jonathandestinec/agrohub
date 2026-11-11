import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { grantRole } from "./grant";
import { totp } from "./totp";

type OutboxMessage = { to: string; subject: string; html: string };

const password = "correct-horse-battery-staple";
const HOME = /:3100\/$/;

// Who is signed in is the account button; Profile and Sign out sit in its dropdown.
const accountButton = (page: Page) => page.getByRole("button", { name: /^Account:/ });
async function signOutFromMenu(page: Page) {
  const account = accountButton(page);
  await expect(async () => {
    if ((await account.getAttribute("aria-expanded")) !== "true") await account.click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
}

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get("/api/dev/outbox");
      expect(response.status()).toBe(200);
      const sent = (await response.json()) as OutboxMessage[];
      const message = sent.filter((m) => m.to === email).at(-1);
      const href = message?.html.match(/href="([^"]+)"/)?.[1];
      link = href?.replace(/&amp;/g, "&");
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("Amina Bello");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Phone number").fill("+2348012345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
}

async function signUpAndVerify(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, email);
  await page.goto(await verificationLink(request, email));
  await expect(page).toHaveURL(/\/verified$/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("sign up, verify the email from the outbox, and land on /verified", async ({
  page,
  request,
}) => {
  const email = uniqueEmail();
  await signUp(page, email);

  const link = await verificationLink(request, email);
  await page.goto(link);

  await expect(page).toHaveURL(/\/verified$/);
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
});

test("signing in with the wrong password shows the invalid message", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(uniqueEmail());
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // By text, not role: the Next route announcer is also role="alert".
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
});

test("a verified user signs in, then signing out clears the session cookie", async ({
  page,
  request,
  context,
}) => {
  const email = uniqueEmail();
  await signUp(page, email);
  await page.goto(await verificationLink(request, email));
  await expect(page).toHaveURL(/\/verified$/);

  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(accountButton(page)).toBeVisible();
  const sessionCookie = async () =>
    (await context.cookies()).find((c) => c.name.endsWith("better-auth.session_token"));
  expect(await sessionCookie()).toBeDefined();

  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect.poll(sessionCookie).toBeUndefined();
});

test("the account menu opens with the keyboard, shows who is signed in, and signs out", async ({
  page,
  request,
  context,
}) => {
  // Sign-up and sign-in on a cold dev server can use most of the 30s default.
  test.setTimeout(60_000);
  const email = uniqueEmail();
  await signUpAndVerify(page, request, email);
  await signIn(page, email);
  const account = accountButton(page);
  await expect(account).toBeVisible();
  // A round avatar: only the initials in the bar (Amina Bello), no name, role or arrow.
  await expect(account).toHaveText("AB");
  const box = (await account.boundingBox())!;
  expect(Math.round(box.width)).toBe(44);
  expect(Math.round(box.height)).toBe(44);
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Amina Bello", { exact: true })).toHaveCount(0);

  // Enter opens it, ArrowDown walks to the first item, Escape closes it and returns focus.
  await account.focus();
  await page.keyboard.press("Enter");
  await expect(account).toHaveAttribute("aria-expanded", "true");
  // The dropdown opens with who is signed in, as plain text the arrow keys skip.
  await expect(page.getByText("Amina Bello", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "Profile" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await expect(account).toBeFocused();

  // A click outside closes it too.
  await account.click();
  await expect(account).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  await expect(account).toHaveAttribute("aria-expanded", "false");

  // Profile shows the person's details.
  await account.click();
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.getByRole("main").getByText(email)).toBeVisible();

  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name.endsWith("better-auth.session_token"))).toBeUndefined();
});

test("a user enrols TOTP on /two-factor, and the next sign-in asks for a code", async ({
  page,
  request,
}) => {
  // Enrolment plus two sign-ins on a cold dev server sits right at the 30s default.
  test.setTimeout(90_000);
  const email = uniqueEmail();
  await signUpAndVerify(page, request, email);
  await signIn(page, email);
  await expect(accountButton(page)).toBeVisible();

  // Enrol: confirm the password, read the setup key, answer with a code.
  await page.goto("/two-factor");
  await expect(page.getByRole("heading", { name: "Set up two-factor authentication" })).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Get setup key" }).click();
  const qr = page.getByRole("img", { name: "QR code to add AgroHub to your authenticator app" });
  await expect(qr).toBeVisible();
  // Drawn locally from the setup link, never fetched from a QR service.
  expect(await qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(HOME);

  // Two-factor is on, so /two-factor no longer offers enrolment.
  await page.goto("/two-factor");
  await expect(page).toHaveURL(HOME);

  // The next sign-in is challenged: a wrong code is refused, the right one signs in.
  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/two-factor$/);
  await expect(page.getByRole("heading", { name: "Enter your sign-in code" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret, Date.now() - 5 * 60_000));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code is not correct. Try the newest code.")).toBeVisible();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(HOME);
  await expect(accountButton(page)).toBeVisible();
});

// Before React hydrates, a submit would be a native form submit. The buttons stay disabled
// until then, so a password can never be sent in the address bar.
test("password forms cannot be submitted before the page is interactive", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    // Without scripts the page never hydrates: the button stays disabled, and a native
    // submit would be a POST, so the password could not reach the address bar either way.
    await expect(page.locator("form button[type=submit]")).toBeDisabled();
    await expect(page.locator("form")).toHaveAttribute("method", "post");
  }
  await context.close();
});

// Sign-in used router.replace then router.refresh, which could leave the page on /sign-in
// (or stop it short of a second redirect) under load. A full load always reaches the landing.
test("signing in always reaches the landing page, even when it redirects again", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const buyer = uniqueEmail();
  await signUpAndVerify(page, request, buyer);
  await signIn(page, buyer);
  // A new account with no membership works from the home page.
  await expect(page).toHaveURL(HOME);
  await expect(accountButton(page)).toBeVisible();

  for (const role of ["ADMIN", "BOARD_ADMIN"] as const) {
    const email = uniqueEmail();
    const context = await page.context().browser()!.newContext();
    const adminPage = await context.newPage();
    await signUpAndVerify(adminPage, request, email);
    await grantRole(email, role);
    await signIn(adminPage, email);
    // No two-factor yet: the landing page sends the user on to enrol.
    await expect(adminPage).toHaveURL(/\/two-factor$/);
    await context.close();
  }
});
