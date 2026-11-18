// Makes the two static email images in public/email/ with Playwright's Chromium (already a dev
// dependency). Run once, by hand, and commit the output: `npx tsx scripts/email-images.ts`.
// Email clients need PNG/JPEG (Gmail drops SVG), so the mark is drawn here and saved as PNG.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const OUT = join(process.cwd(), "public", "email");

// The favicon variant of the AgroHub mark (larger leaves than the in-app Mark, so it reads at 40px).
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="80" height="80">
<circle cx="16" cy="16" r="16" fill="#dcef6a"/>
<g transform="translate(16 16) scale(1.6) translate(-16 -12)">
<path d="M16 12c0-3 2.5-5 6-5 0 3.5-2.5 6-6 5Z" fill="#173a2a"/>
<path d="M16 16c0-3-2.5-5-6-5 0 3.5 2.5 6 6 5Z" fill="#173a2a"/>
</g>
</svg>`;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const mark = await browser.newPage({ viewport: { width: 80, height: 80 } });
    await mark.setContent(
      `<html><body style="margin:0;background:transparent">${MARK_SVG}</body></html>`,
    );
    await mark.screenshot({
      path: join(OUT, "mark@2x.png"),
      omitBackground: true,
      clip: { x: 0, y: 0, width: 80, height: 80 },
    });

    const photo = readFileSync(join(process.cwd(), "public", "photos", "cooperative.jpg")).toString("base64");
    const hero = await browser.newPage({ viewport: { width: 960, height: 384 } });
    await hero.setContent(
      `<html><body style="margin:0"><img src="data:image/jpeg;base64,${photo}" style="display:block;width:960px;height:384px;object-fit:cover;object-position:50% 0%"></body></html>`,
    );
    await hero.waitForLoadState("load");
    await hero.screenshot({
      path: join(OUT, "hero-cooperative.jpg"),
      type: "jpeg",
      quality: 66,
      clip: { x: 0, y: 0, width: 960, height: 384 },
    });
  } finally {
    await browser.close();
  }
  for (const file of ["mark@2x.png", "hero-cooperative.jpg"]) {
    console.log(`${file}: ${statSync(join(OUT, file)).size} bytes`);
  }
}

void main();
