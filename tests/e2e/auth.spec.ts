import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { totp } from "./totp";

type OutboxMessage = { to: string; subject: string; html: string };

const password = "correct-horse-battery-staple";
const HOME = /:3100\/$/;

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

  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  const sessionCookie = async () =>
    (await context.cookies()).find((c) => c.name.endsWith("better-auth.session_token"));
  expect(await sessionCookie()).toBeDefined();

  await signOut.click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect.poll(sessionCookie).toBeUndefined();
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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

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
  await page.getByRole("button", { name: "Sign out" }).click();
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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
