import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/modules/notifications/email-layout";

const PUBLIC = join(process.cwd(), "public");

describe("email images", () => {
  it("are small PNG/JPEG files", () => {
    const mark = join(PUBLIC, "email", "mark@2x.png");
    const hero = join(PUBLIC, "email", "hero-cooperative.jpg");
    expect(statSync(mark).size).toBeLessThanOrEqual(6 * 1024);
    expect(statSync(hero).size).toBeLessThanOrEqual(90 * 1024);
    // PNG and JPEG signatures: never an SVG under another name.
    expect(readFileSync(mark).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(readFileSync(hero).subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("exist for every image the layout links to", () => {
    const { html } = renderEmail({ preheader: "p", bodyHtml: "<p>x</p>", hero: "cooperative" });
    const paths = [...html.matchAll(/<img[^>]*src="https?:\/\/[^/"]+(\/[^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(path.startsWith("/email/"), path).toBe(true);
      expect(existsSync(join(PUBLIC, path)), path).toBe(true);
    }
  });
});
