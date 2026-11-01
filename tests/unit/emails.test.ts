import { describe, expect, it } from "vitest";
import {
  bankChangeAdminAlertEmail,
  bankChangeConfirmEmail,
  cooperativeStatusEmail,
  farmerInviteEmail,
} from "@/modules/notifications/emails";

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

describe("bank change emails", () => {
  const confirm = () =>
    bankChangeConfirmEmail({
      ownerName: "A & B <Farmers>",
      link: "http://localhost:3000/bank/confirm?token=abc_-123",
    });
  const alert = () =>
    bankChangeAdminAlertEmail({
      ownerName: "A & B <Farmers>",
      accountName: "<b>ADA</b>",
      bankName: "Access Bank",
      effectiveAt: new Date("2031-06-12T12:00:00Z"),
    });

  it("escapes names and includes the confirmation link", () => {
    const { html } = confirm();
    expect(html).toContain("A &amp; B &lt;Farmers&gt;");
    expect(html).toContain('href="http://localhost:3000/bank/confirm?token=abc_-123"');
    expect(html).toMatch(/48 hours/);
  });

  it("gives admins the owner, account name, bank and effective time", () => {
    const { html } = alert();
    expect(html).toContain("A &amp; B &lt;Farmers&gt;");
    expect(html).toContain("&lt;b&gt;ADA&lt;/b&gt;");
    expect(html).toContain("Access Bank");
    expect(html).toContain("2031-06-12 12:00 UTC");
  });

  it("never uses the word escrow", () => {
    for (const { subject, html } of [confirm(), alert()]) {
      expect(`${subject} ${html}`).not.toMatch(/escrow/i);
    }
  });
});

describe("farmerInviteEmail", () => {
  it("escapes the cooperative name and the link, and shows the link", () => {
    const { subject, html } = farmerInviteEmail({
      cooperativeName: "A & B <Farmers>",
      link: "http://localhost:3000/join/abc_-123?x=1&y=\"2\"",
    });
    expect(html).toContain("A &amp; B &lt;Farmers&gt;");
    expect(html).not.toContain("<Farmers>");
    expect(html).toContain('href="http://localhost:3000/join/abc_-123?x=1&amp;y=&quot;2&quot;"');
    expect(subject).not.toContain("A & B");
  });

  it("never uses the word escrow", () => {
    const { subject, html } = farmerInviteEmail({ cooperativeName: "Zaria Growers", link: "http://x/join/t" });
    expect(`${subject} ${html}`.toLowerCase()).not.toContain("escrow");
  });
});
