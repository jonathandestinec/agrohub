import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { chromium } from "playwright";

// Makes the link-preview image (WhatsApp, X, LinkedIn, Slack): src/app/opengraph-image.jpg.
// Run after changing the design: `npx tsx --tsconfig scripts/tsconfig.json scripts/og-image.tsx`.
//
// The design is drawn with next/og (which only outputs PNG), then saved as a JPEG through
// Playwright's Chromium, because the photo makes the PNG about 950 KB and WhatsApp skips
// preview images over about 300 KB. The JPEG is a static file, so nothing renders at runtime.
//
// Brand mark, landing headline, and the cooperative photo (public domain, so no credit line).
// Colours are the brand tokens in src/styles/tokens.css; the font is next/og's bundled Geist,
// the app's own typeface. Alt text lives in src/app/opengraph-image.alt.txt.

const size = { width: 1200, height: 630 };
const JPEG_QUALITY = 82;

const FOREST = "#173a2a";
const FOREST_INK = "#f3f7ef";
const LIME = "#dcef6a";
const SOFT = "#b9c8b6";

function BrandMark({ size: px }: { size: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill={LIME} />
      <path d="M16 12c0-3 2.5-5 6-5 0 3.5-2.5 6-6 5Z" fill={FOREST} />
      <path d="M16 16c0-3-2.5-5-6-5 0 3.5 2.5 6 6 5Z" fill={FOREST} />
    </svg>
  );
}

async function renderPng(): Promise<ImageResponse> {
  const photo = await readFile(join(process.cwd(), "public/photos/cooperative.jpg"));
  const photoSrc = `data:image/jpeg;base64,${photo.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: FOREST }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 760,
            padding: "64px 56px 60px 72px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <BrandMark size={64} />
            <div style={{ fontSize: 44, color: FOREST_INK, letterSpacing: -1 }}>AgroHub</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 26, color: LIME, marginBottom: 20 }}>For farmer cooperatives in Nigeria</div>
            <div style={{ fontSize: 66, lineHeight: 1.06, color: FOREST_INK, letterSpacing: -3 }}>Sell together.</div>
            <div style={{ fontSize: 66, lineHeight: 1.06, color: LIME, letterSpacing: -3 }}>Get paid on delivery.</div>
          </div>
          <div style={{ fontSize: 26, lineHeight: 1.35, color: SOFT }}>
            Buyers pay upfront. The payment is held until delivery is confirmed.
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img only */}
        <img src={photoSrc} alt="" width={440} height={630} style={{ objectFit: "cover" }} />
      </div>
    ),
    size,
  );
}

async function main(): Promise<void> {
  const png = Buffer.from(await (await renderPng()).arrayBuffer());
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: size });
    await page.setContent(
      `<html><body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}"></body></html>`,
    );
    const jpg = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY });
    const out = join(process.cwd(), "src/app/opengraph-image.jpg");
    await writeFile(out, jpg);
    console.log(`wrote ${out}: ${Math.round(jpg.length / 1024)} KB (PNG was ${Math.round(png.length / 1024)} KB)`);
  } finally {
    await browser.close();
  }
}

void main();
