import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthCard, Field, FormError } from "@/components/auth-ui";
import { PHOTOS } from "@/components/ui/photo-credits";

describe("Field", () => {
  it("links hint and error and marks the input invalid", () => {
    const html = renderToStaticMarkup(
      createElement(Field, { id: "email", label: "Email", hint: "We send a link", error: "Enter an email" }),
    );
    expect(html).toContain('aria-describedby="email-hint email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="email-error"');
  });

  it("has no aria-describedby without hint or error", () => {
    expect(renderToStaticMarkup(createElement(Field, { id: "x", label: "X" }))).not.toContain(
      "aria-describedby",
    );
  });
});

describe("FormError", () => {
  it("is an alert, and renders nothing for null", () => {
    expect(renderToStaticMarkup(createElement(FormError, { message: "Wrong code" }))).toContain(
      'role="alert"',
    );
    expect(renderToStaticMarkup(createElement(FormError, { message: null }))).toBe("");
  });
});

describe("AuthCard", () => {
  it("puts the photo in a desktop-only column", () => {
    const html = renderToStaticMarkup(
      AuthCard({ title: "Sign in", photo: "harvest", caption: "Members sell together", children: "form" }),
    );
    expect(html).toMatch(/hidden[^"]*md:block/);
    expect(html).toContain("Members sell together");
  });

  it("lets the form column shrink so a long unbroken word cannot widen the page", () => {
    const html = renderToStaticMarkup(AuthCard({ title: "Sign up", photo: "cooperative", children: "form" }));
    expect(html).toMatch(/<section[^>]*\bmin-w-0\b/);
  });

  it("renders no image without a photo", () => {
    expect(renderToStaticMarkup(AuthCard({ title: "Two-step", children: "form" }))).not.toContain("<img");
  });
});

describe("PHOTOS", () => {
  it("every photo has alt text and a Wikimedia credit", () => {
    for (const p of Object.values(PHOTOS)) {
      expect(p.alt.length).toBeGreaterThan(10);
      expect(p.credit.url).toMatch(/^https:\/\/commons\.wikimedia\.org/);
    }
  });
});
