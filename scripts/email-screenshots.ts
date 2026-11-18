// Screenshots the rendered email previews for the PR. Start the preview server first
// (`npx tsx scripts/email-previews.ts`), then run `npx tsx scripts/email-screenshots.ts`.
// Writes docs/email-screenshots/*.png.

import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ORIGIN = "http://localhost:4310";
const OUT = join(process.cwd(), "docs", "email-screenshots");

const SHOTS: Array<{ page: string; width: number; scheme: "light" | "dark" }> = [
  { page: "verification", width: 375, scheme: "light" },
  { page: "password-reset", width: 375, scheme: "light" },
  { page: "alert-payment-held", width: 375, scheme: "light" },
  { page: "admin-payout-failed", width: 375, scheme: "light" },
  { page: "verification", width: 1280, scheme: "light" },
  { page: "password-reset", width: 1280, scheme: "light" },
  { page: "verification", width: 375, scheme: "dark" },
  { page: "alert-payment-held", width: 375, scheme: "dark" },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: 800 },
        colorScheme: shot.scheme,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/${shot.page}.html`, { waitUntil: "load" });
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const file = join(OUT, `${shot.page}-${shot.width}-${shot.scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${file}: ${statSync(file).size} bytes${scroll ? " (HORIZONTAL SCROLL)" : ""}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
