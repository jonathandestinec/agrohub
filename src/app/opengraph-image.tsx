import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The link-preview image (WhatsApp, X, LinkedIn, Slack): the brand mark, the landing headline,
// and the cooperative photo (public domain, so it needs no credit line). Built once at build time.
// Colours are the brand tokens in src/styles/tokens.css; the font is next/og's bundled Geist,
// the app's own typeface.

export const alt = "AgroHub: farmer cooperatives sell together and get paid on delivery";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

export default async function OpengraphImage() {
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
