import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteMetadata, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

describe("siteMetadata", () => {
  const meta = siteMetadata("https://agro-hub.com.ng");

  it("sets an absolute base so the share image URL is absolute", () => {
    expect(meta.metadataBase?.toString()).toBe("https://agro-hub.com.ng/");
  });

  it("describes the site for link previews", () => {
    expect(meta.title).toBe(SITE_NAME);
    expect(meta.description).toBe(SITE_DESCRIPTION);
    expect(meta.openGraph).toMatchObject({ siteName: SITE_NAME, type: "website", locale: "en_NG" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("never says escrow", () => {
    expect(JSON.stringify(meta).toLowerCase()).not.toContain("escrow");
  });
});

describe("icon.svg", () => {
  const svg = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");

  it("draws the AgroHub mark in its brand colours", () => {
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg.toLowerCase()).toContain("#dcef6a"); // lime disc
    expect(svg.toLowerCase()).toContain("#173a2a"); // forest leaves
  });

  it("uses no CSS variables, which a favicon cannot resolve", () => {
    expect(svg).not.toContain("var(");
  });
});

describe("favicon.ico", () => {
  const ico = readFileSync(join(process.cwd(), "src/app/favicon.ico"));

  it("is an icon file holding the brand mark, not the Next.js default", () => {
    // ICONDIR: reserved 0, type 1 (icon), at least one image.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
    // The images are PNG-encoded (the brand build); the Next default is BMP-encoded.
    const offset = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(offset, offset + 4).toString("latin1")).toBe("\x89PNG");
  });
});
