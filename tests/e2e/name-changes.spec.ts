import { expect, test } from "@playwright/test";
import { grantAdmin } from "./grant";
import {
  clickNav,
  completeSignUp,
  enrolTwoFactor,
  LANDING,
  newPage,
  PDF,
  signIn,
  uniqueEmail,
  uniqueTag,
} from "./journey";
import { setUpLotWorld } from "./lot-world";

// Name changes: a farmer asks to change their name and cannot change their bank account
// while it waits; an officer asks to rename the verified cooperative; an admin approves the
// first and rejects the second, and each requester sees the outcome.

test("an admin approves a farmer's name change and rejects a cooperative rename", async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  const tag = uniqueTag();
  const cooperative = `Harvest ${tag} Cooperative`;
  const newCooperative = `Harvest ${tag} Soy Cooperative`;
  const officer = { name: "Ngozi Okafor", email: uniqueEmail("nc-officer") };
  const farmer = { name: `Amina ${tag}`, email: uniqueEmail("nc-farmer") };
  const admin = { name: "Bola Adeyemi", email: uniqueEmail("nc-admin") };
  const newFarmerName = `Amina ${tag} Musa`;

  const officerPage = await newPage(browser);
  const farmerPage = await newPage(browser);
  const adminPage = await newPage(browser);

  await test.step("setup: sign-ups, the verified cooperative with a payout account, an admin", async () => {
    // The first visit to a new route in next dev can outlast the expect timeout.
    for (const path of ["/account/name", "/admin/names", "/admin/names/warm", "/admin/cooperatives/warm"]) {
      await request.get(path);
    }
    for (const [page, user] of [
      [officerPage, officer],
      [farmerPage, farmer],
      [adminPage, admin],
    ] as const) {
      await page.goto("/sign-up");
      await completeSignUp(page, request, user);
    }
    await setUpLotWorld({
      tag,
      cooperative,
      crop: `Maize ${tag}`,
      unit: `Bag ${tag}`,
      officerEmail: officer.email,
      farmerEmail: farmer.email,
      cooperativeAccountName: `HARVEST ${tag} COOPERATIVE SOCIETY`,
    });
    await grantAdmin(admin.email);
    for (const [page, user, landing] of [
      [officerPage, officer, LANDING.officer],
      [farmerPage, farmer, LANDING.farmer],
      [adminPage, admin, LANDING.twoFactor],
    ] as const) {
      await signIn(page, user.email);
      await expect(page).toHaveURL(landing);
    }
  });

  await test.step("1. the farmer asks for a name change with an affidavit", async () => {
    const page = farmerPage;
    await page.goto("/farmer");
    await page.getByRole("main").getByRole("link", { name: "Change my name" }).click();
    await expect(page.getByRole("heading", { name: "Change my name" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByText(farmer.name, { exact: true })).toBeVisible();
    await main.getByLabel("New name").fill(newFarmerName);
    await main.getByLabel("Why is the name changing?").fill("Married in October 2026");
    await main.getByLabel("Supporting document").selectOption({ label: "Affidavit of change of name" });
    await main.getByLabel("Document file").setInputFiles({
      name: "affidavit.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await main.getByRole("button", { name: "Send for review" }).click();
    await expect(main.getByRole("heading", { name: "Waiting for an admin" })).toBeVisible();
  });

  await test.step("2. while it waits, the farmer cannot change their bank account", async () => {
    const page = farmerPage;
    await page.goto("/farmer");
    const main = page.getByRole("main");
    await main.getByLabel("Bank", { exact: true }).selectOption({ label: "Access Bank" });
    await main.getByLabel("Account number").fill("0123456789");
    await expect(main.getByText("A name change is waiting for an admin.", { exact: false })).toBeVisible();
  });

  await test.step("3. the officer turns on two-factor and asks to rename the cooperative", async () => {
    const page = officerPage;
    await page.goto("/officer/onboarding");
    const card = page.getByRole("main");
    await expect(card.getByRole("heading", { name: "Cooperative name" })).toBeVisible();
    await card.getByRole("link", { name: "Set up two-factor", exact: true }).click();
    await enrolTwoFactor(page);
    await page.goto("/officer/onboarding");
    const main = page.getByRole("main");
    await main.getByLabel("New name").fill(newCooperative);
    await main.getByLabel("Why is the name changing?").fill("Members voted to add soy in 2026");
    await main.getByLabel("Document file").setInputFiles({
      name: "certificate.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await main.getByRole("button", { name: "Send for review" }).click();
    await expect(main.getByRole("heading", { name: "Waiting for an admin" })).toBeVisible();
  });

  await test.step("4. the admin approves the farmer's change and rejects the rename", async () => {
    const page = adminPage;
    await expect(page).toHaveURL(LANDING.twoFactor);
    await enrolTwoFactor(page);
    await clickNav(page, "Name changes");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Name changes" })).toBeVisible();

    await main.getByRole("link", { name: new RegExp(newFarmerName) }).click();
    await expect(page.getByRole("main").getByText("It does not match the new name", { exact: false })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Approve name change" }).click();
    await expect(page.getByRole("main").getByText(/^Approved on/)).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Back to name changes" }).click();
    await page.getByRole("main").getByRole("link", { name: new RegExp(newCooperative) }).click();
    const detail = page.getByRole("main");
    await detail.getByLabel("Reason (shown to the person who asked)").fill("Certificate is unreadable");
    await detail.getByRole("button", { name: "Reject" }).click();
    await expect(detail.getByText(/^Rejected on .*Certificate is unreadable/)).toBeVisible();

    // The cooperative's own review page shows its payout account.
    await detail.getByRole("link", { name: "Open the cooperative" }).click();
    await expect(page.getByRole("heading", { name: cooperative })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(`HARVEST ${tag} COOPERATIVE SOCIETY at Guaranty Trust Bank`),
    ).toBeVisible();
  });

  await test.step("5. each requester sees the outcome", async () => {
    await farmerPage.goto("/account/name");
    const farmerMain = farmerPage.getByRole("main");
    await expect(farmerMain.getByText(newFarmerName, { exact: true })).toBeVisible();
    await expect(farmerMain.getByText(/^Approved on/)).toBeVisible();

    await officerPage.goto("/officer/onboarding");
    await expect(
      officerPage.getByRole("main").getByText("Not approved: Certificate is unreadable"),
    ).toBeVisible();
  });
});
