import { describe, expect, it } from "vitest";
import { escapeHtml, htmlToText, renderEmail } from "@/modules/notifications/email-layout";

const BASE = "http://localhost:3000";
const BANNED = ["escrow", "floor", "phone", "bank account", "undefined", "<b>", "<i>", "<script", "<link", ".svg"];

const imgTags = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

describe("renderEmail", () => {
  const basic = () =>
    renderEmail({
      preheader: "A short preview line.",
      bodyHtml: "<p>Hello <strong>Zaria Growers</strong>.</p>",
    });

  it("wraps the body in one email-safe layout", () => {
    const { html } = basic();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="en"');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toMatch(/<table[^>]*role="presentation"[^>]*width="600"/);
    expect(html).toContain(">AgroHub<");
    expect(html).toContain("Zaria Growers");
    expect(html).toContain("A short preview line.");
  });

  it("styles the body's paragraphs inline", () => {
    const { html } = basic();
    expect(html).not.toMatch(/<p>/);
    expect(html).toMatch(/<p style="[^"]+">Hello/);
  });

  it("shows the mark as an absolute PNG with alt text and no link", () => {
    const { html } = basic();
    const mark = imgTags(html).find((tag) => tag.includes("mark@2x.png"));
    expect(mark).toBeDefined();
    expect(mark).toContain(`src="${BASE}/email/mark@2x.png"`);
    expect(mark).toContain('width="40"');
    expect(mark).toContain('height="40"');
    expect(mark).toContain('alt="AgroHub"');
    expect(html).not.toContain("href=");
  });

  it("gives every image an absolute src and a non-empty alt", () => {
    const { html } = renderEmail({ preheader: "p", bodyHtml: "<p>x</p>", hero: "cooperative" });
    const tags = imgTags(html);
    expect(tags.length).toBe(2);
    for (const tag of tags) {
      expect(tag).toMatch(/src="https?:\/\/[^"]+\.(png|jpg)"/);
      expect(tag).toMatch(/alt="[^"]+"/);
    }
  });

  it("makes the action the first link, escaped", () => {
    const { html } = renderEmail({
      preheader: "p",
      bodyHtml: "<p>Before.</p>",
      afterHtml: "<p>After.</p>",
      action: { label: "Open <it>", href: "https://x.test/a?b=1&c=\"2\"" },
    });
    const first = html.match(/href="([^"]+)"/)?.[1];
    expect(first).toBe("https://x.test/a?b=1&amp;c=&quot;2&quot;");
    expect(html).toContain("Open &lt;it&gt;");
    expect(html.indexOf("Before.")).toBeLessThan(html.indexOf("Open &lt;it&gt;"));
    expect(html.indexOf("Open &lt;it&gt;")).toBeLessThan(html.indexOf("After."));
  });

  it("shows the hero photo only when asked", () => {
    const withHero = renderEmail({ preheader: "p", bodyHtml: "<p>x</p>", hero: "cooperative" }).html;
    const hero = imgTags(withHero).find((tag) => tag.includes("hero-cooperative.jpg"));
    expect(hero).toContain(`src="${BASE}/email/hero-cooperative.jpg"`);
    expect(hero).toContain('width="600"');
    expect(hero).toMatch(/alt="Members of a farmer cooperative/);
    expect(withHero).toMatch(/USAID in Africa/);
    expect(basic().html).not.toContain("hero-cooperative.jpg");
    expect(basic().html).not.toContain("USAID");
  });

  it("adds a fallback link after the button when asked", () => {
    const href = "https://x.test/reset-password/tok?callbackURL=%2Fa&x=1";
    const { html } = renderEmail({
      preheader: "p",
      bodyHtml: "<p>x</p>",
      action: { label: "Go", href },
      fallbackLink: true,
    });
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs[0]).toBe(escapeHtml(href));
    expect(hrefs[1]).toBe(escapeHtml(href));
    expect(html).toContain("If the button does not work");
    expect(html.indexOf("If the button does not work")).toBeGreaterThan(html.indexOf(">Go<"));
  });

  it("never adds a fallback link without an action", () => {
    const { html } = renderEmail({ preheader: "p", bodyHtml: "<p>x</p>", fallbackLink: true });
    expect(html).not.toContain("If the button does not work");
  });

  it("returns a plain-text alternative without tags or the preheader", () => {
    const { text } = renderEmail({
      preheader: "Hidden preview only.",
      bodyHtml: "<p>Hello <strong>A &amp; B &lt;Farmers&gt;</strong>.</p><ul><li>One</li><li>Two</li></ul>",
      afterHtml: "<p>Line one<br>Line two</p>",
      action: { label: "Open AgroHub", href: "https://x.test/a?b=1&c=2" },
    });
    expect(text).toContain("Hello A & B <Farmers>.");
    expect(text).toContain("- One\n- Two");
    expect(text).toContain("Open AgroHub: https://x.test/a?b=1&c=2");
    expect(text).toContain("Line one\nLine two");
    expect(text).not.toContain("Hidden preview only.");
    expect(text).not.toMatch(/<\/?[a-z]/);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain("AgroHub");
  });

  it("contains none of the banned words or tags", () => {
    const outputs = [
      basic(),
      renderEmail({
        preheader: "p",
        bodyHtml: "<p>x</p>",
        action: { label: "Go", href: "https://x.test" },
        fallbackLink: true,
        hero: "cooperative",
      }),
    ];
    for (const { html, text } of outputs) {
      for (const banned of BANNED) {
        expect(html.toLowerCase()).not.toContain(banned);
        expect(text.toLowerCase()).not.toContain(banned);
      }
    }
  });

  it("keeps the dark-mode and small-screen rules in one small style block", () => {
    const { html } = basic();
    const styles = html.match(/<style[\s\S]*?<\/style>/g) ?? [];
    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain("prefers-color-scheme: dark");
    expect(styles[0]).toContain("max-width: 620px");
  });
});

describe("htmlToText", () => {
  it("decodes entities once and keeps line breaks", () => {
    expect(htmlToText("<p>A &amp;amp; B</p><p>C<br>D</p>")).toBe("A &amp; B\n\nC\nD");
  });
});
