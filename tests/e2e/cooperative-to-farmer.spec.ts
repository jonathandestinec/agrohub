import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { grantAdmin } from "./grant";
import {
  clickNav,
  completeSignUp,
  fillSignIn,
  HOME,
  nav,
  newPage,
  password,
  signIn,
  uniqueEmail,
  uniqueTag,
} from "./journey";
import { totp } from "./totp";

// The whole Phase 1 journey: an officer sets up a cooperative, an admin verifies it, a
// farmer joins through the invite link, and the officer approves them. Each actor has
// their own browser context, so their sessions never mix.

// A tiny but valid PDF: the upload checks the %PDF magic bytes.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

// Ten digits, unique enough per run that fake accounts never collide.
function uniqueAccountNumber(): string {
  return String(Math.floor(Math.random() * 1e10)).padStart(10, "0");
}

async function addFakeBankAccount(
  request: APIRequestContext,
  account: { bankCode: string; accountNumber: string; accountName: string },
) {
  const response = await request.post("/api/dev/paystack/accounts", { data: account });
  expect(response.status()).toBe(201);
}

// Enrols TOTP on /two-factor, answering with a code computed from the setup key shown.
async function enrolTwoFactor(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Set up two-factor authentication" }),
  ).toBeVisible();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Get setup key" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(HOME);
}

async function saveBankAccount(page: Page, bankName: string, accountNumber: string) {
  await page.getByLabel("Bank", { exact: true }).selectOption({ label: bankName });
  await page.getByLabel("Account number").fill(accountNumber);
  // The bank's name for the account shows, with whether it matches, before saving.
  await expect(page.getByText("Account name:")).toBeVisible();
  await expect(page.getByText(/^This matches/)).toBeVisible();
  await page.getByRole("button", { name: "Save bank account" }).click();
}

test("an officer's cooperative is verified, and a farmer joins it and is approved", async ({
  browser,
  request,
}) => {
  // One long journey through four pages per actor, each compiled on first visit by next dev.
  test.setTimeout(240_000);

  const tag = uniqueTag();
  const cooperativeName = `Sunrise ${tag} Farmers Cooperative`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("officer") };
  const admin = { name: "Tunde Bakare", email: uniqueEmail("admin") };
  const farmer = { name: `Musa ${tag}`, email: uniqueEmail("farmer") };

  const officerPage = await newPage(browser);
  const adminPage = await newPage(browser);
  const farmerPage = await newPage(browser);
  await officerPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await test.step("1. the officer signs up, creates the cooperative, uploads documents and adds a bank account", async () => {
    const page = officerPage;
    await page.goto("/sign-up");
    await completeSignUp(page, request, officer);
    await signIn(page, officer.email);
    await expect(page).toHaveURL(HOME);

    // No membership yet: the header offers to register a cooperative.
    await clickNav(page, "Register your cooperative");
    await expect(page.getByRole("heading", { name: "Set up your cooperative" })).toBeVisible();
    await page.getByLabel("Cooperative name").fill(cooperativeName);
    await page.getByLabel("Registration number").fill(`RC-${tag}`);
    await page.getByLabel("State").selectOption("Kaduna");
    await page.getByLabel("Local government area").fill("Zaria");
    await page.getByLabel("Certificate expiry date").fill("2030-01-01");
    await page.getByRole("button", { name: "Create cooperative" }).click();
    await expect(page.getByRole("heading", { name: cooperativeName })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(
      "Upload all three documents to send your cooperative for review.",
    );

    // While PENDING, the officer can correct the details.
    await page.getByText("Correct your cooperative's details").click();
    await page.getByLabel("Local government area").fill("Sabon Gari");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Details saved.")).toBeVisible();
    await expect(page.getByText(`RC-${tag} · Sabon Gari, Kaduna`)).toBeVisible();

    for (const [label, file] of [
      ["Registration certificate", "certificate.pdf"],
      ["Bylaws", "bylaws.pdf"],
      ["List of officers", "officers.pdf"],
    ] as const) {
      const form = page.locator("form").filter({ has: page.getByLabel(label) });
      await form.getByLabel(label).setInputFiles({
        name: file,
        mimeType: "application/pdf",
        buffer: PDF,
      });
      if (label === "Registration certificate") {
        // A certificate upload carries its expiry date (it is how renewals work).
        await form.getByLabel("Certificate expiry date").fill("2030-01-01");
      }
      await form.getByRole("button", { name: "Upload" }).click();
      await expect(form.getByText("Uploaded", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("status")).toContainText("Waiting for review since");

    // The bank account needs two-factor first.
    await page.getByRole("link", { name: "Set up two-factor authentication" }).click();
    await enrolTwoFactor(page);

    const accountNumber = uniqueAccountNumber();
    const accountName = `SUNRISE ${tag} FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD`;
    await addFakeBankAccount(request, { bankCode: "058", accountNumber, accountName });
    await clickNav(page, "My cooperative");
    await expect(page.getByRole("heading", { name: cooperativeName })).toBeVisible();
    await expect(nav(page, "My cooperative")).toHaveAttribute("aria-current", "page");
    await saveBankAccount(page, "Guaranty Trust Bank", accountNumber);
    await expect(page.getByText(`Saved. The name on the account is ${accountName}.`)).toBeVisible();
    await expect(
      page.getByText(`Payouts go to ${accountName} at Guaranty Trust Bank.`),
    ).toBeVisible();
  });

  await test.step("2. an admin, granted in setup, enrols two-factor and verifies the cooperative", async () => {
    const page = adminPage;
    await page.goto("/sign-up");
    await completeSignUp(page, request, admin);
    // Test setup: grantRole, the same grant `npm run admin:grant` performs.
    await grantAdmin(admin.email);

    await signIn(page, admin.email);
    await expect(page).toHaveURL(HOME);
    // An admin without two-factor is sent to enrol before the queue opens.
    await clickNav(page, "Review cooperatives");
    await expect(page).toHaveURL(/\/two-factor$/);
    await enrolTwoFactor(page);

    // Clicked, not loaded with goto: pins that enrolling clears the client router's
    // cached redirect to /two-factor (it used to bounce the admin back home).
    await clickNav(page, "Review cooperatives");
    await expect(page.getByRole("heading", { name: "Cooperatives awaiting review" })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(cooperativeName) }).click();
    await expect(page.getByRole("heading", { name: cooperativeName })).toBeVisible();
    await page.getByRole("button", { name: "Verify" }).click();
    // Once verified, the only decision left is to suspend.
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify" })).toHaveCount(0);
  });

  let inviteUrl = "";
  await test.step("3. the officer copies the invite link", async () => {
    const page = officerPage;
    await clickNav(page, "Invite farmers");
    await expect(page.getByRole("heading", { name: "Invite farmers" })).toBeVisible();
    // The cooperative is verified now, so there is no "not verified yet" notice.
    await expect(page.getByText(/Farmers can join only after/)).toHaveCount(0);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    inviteUrl = await page.evaluate(() => navigator.clipboard.readText());
    await expect(page.getByLabel("Invite link")).toHaveValue(inviteUrl);
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3100\/join\/[^/]+$/);
  });

  await test.step("4. the farmer opens the link, signs up, completes the profile and bank, and waits", async () => {
    const page = farmerPage;
    await page.goto(inviteUrl);
    await expect(page.getByRole("heading", { name: `Join ${cooperativeName}` })).toBeVisible();
    await page.getByRole("link", { name: "Create an account" }).click();
    await completeSignUp(page, request, farmer);
    // Only on-page links from here: the verified page must lead back to the invite.
    const joinPath = new URL(inviteUrl).pathname;
    // The verified page's own link, not the header's plain "Sign in".
    await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/sign-in" && url.searchParams.get("next") === joinPath,
    );
    await fillSignIn(page, farmer.email);
    await expect(page).toHaveURL(new RegExp(`${joinPath}$`));

    await page.getByLabel("Farm size (hectares)").fill("2.5");
    await page.getByLabel("State").selectOption("Kaduna");
    await page.getByLabel("Local government area").fill("Zaria");
    await page.getByRole("button", { name: "Join cooperative" }).click();
    await expect(page.getByRole("heading", { name: cooperativeName })).toBeVisible();
    await expect(page.getByText("Waiting for your officer's approval")).toBeVisible();
    // Pending approval, so no ACTIVE membership: the header links to the farm page.
    // (Scrolled up first: the pinned nav hides its links while the page is scrolled down.)
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav(page, "Your farm")).toBeVisible();

    const accountNumber = uniqueAccountNumber();
    const accountName = `MUSA ${tag} ABUBAKAR`;
    await addFakeBankAccount(request, { bankCode: "044", accountNumber, accountName });
    await saveBankAccount(page, "Access Bank", accountNumber);
    await expect(page.getByText(`Saved. The name on the account is ${accountName}.`)).toBeVisible();
    await expect(page.getByText(`Payouts go to ${accountName}.`)).toBeVisible();
    await expect(page.getByText("Waiting for your officer's approval")).toBeVisible();
  });

  await test.step("5. the officer approves the farmer", async () => {
    const page = officerPage;
    await clickNav(page, "Farmers");
    await expect(page.getByRole("heading", { name: "Your farmers" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: farmer.name });
    await expect(row).toContainText("Bank account added");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("No farmers are waiting for approval.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: farmer.name })).toBeVisible();
  });

  await test.step("6. the farmer reloads and sees they are approved", async () => {
    const page = farmerPage;
    await page.reload();
    await expect(page.getByText("Your officer has approved you.")).toBeVisible();
    await clickNav(page, "My farm");
    await expect(page.getByRole("heading", { name: cooperativeName })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("You are an approved member.");
  });
});
