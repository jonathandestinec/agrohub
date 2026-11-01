import { describe, expect, it } from "vitest";
import { cooperativeStatusEmail } from "@/modules/notifications/emails";

const kinds = ["verified", "rejected", "suspended", "reinstated"] as const;

describe("cooperativeStatusEmail", () => {
  it("escapes the reason and the cooperative name", () => {
    const { html } = cooperativeStatusEmail("rejected", {
      cooperativeName: "A & B <Farmers>",
      reason: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B &lt;Farmers&gt;");
  });

  it("returns a subject and html for every kind", () => {
    for (const kind of kinds) {
      const email = cooperativeStatusEmail(kind, {
        cooperativeName: "Zaria Growers",
        reason: "Certificate is unreadable",
      });
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain("Zaria Growers");
    }
  });

  it("includes the reason when given and never prints undefined", () => {
    const rejected = cooperativeStatusEmail("rejected", {
      cooperativeName: "Zaria Growers",
      reason: "Bylaws page missing",
    });
    expect(rejected.html).toContain("Bylaws page missing");
    for (const kind of kinds) {
      const email = cooperativeStatusEmail(kind, {
        cooperativeName: "Zaria Growers",
      });
      expect(email.html).not.toContain("undefined");
    }
  });

  it("never uses the word escrow", () => {
    for (const kind of kinds) {
      const { subject, html } = cooperativeStatusEmail(kind, {
        cooperativeName: "Zaria Growers",
        reason: "Some reason",
      });
      expect(`${subject} ${html}`).not.toMatch(/escrow/i);
    }
  });
});
