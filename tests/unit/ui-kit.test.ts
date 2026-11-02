import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonClass, Chip, PageHeading } from "@/components/ui";

describe("Button", () => {
  it("defaults to type=button and passes disabled", () => {
    const html = renderToStaticMarkup(createElement(Button, { disabled: true }, "Go"));
    expect(html).toContain('type="button"');
    expect(html).toContain("disabled");
  });

  it("lime tone uses the lime fill and lime ink", () => {
    expect(buttonClass("lime")).toMatch(/\bbg-lime\b/);
    expect(buttonClass("lime")).toMatch(/\btext-lime-ink\b/);
  });

  it("lg buttons are 48px tall, md buttons 44px", () => {
    expect(buttonClass("ink", "lg")).toMatch(/\bmin-h-12\b/);
    expect(buttonClass("ink")).toMatch(/\bmin-h-11\b/);
  });
});

describe("PageHeading", () => {
  it("renders one h1 with the lead", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeading, { title: "Farmers", lead: "Approve new members" }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Approve new members");
  });
});

describe("Chip", () => {
  it("forest tone uses the forest fill", () => {
    expect(renderToStaticMarkup(Chip({ tone: "forest", children: "Verified" }))).toMatch(
      /\bbg-forest\b/,
    );
  });
});
