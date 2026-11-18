import { describe, expect, it } from "vitest";
import {
  alertEmail,
  bankChangeAdminAlertEmail,
  bankChangeConfirmEmail,
  certificateExpiredEmail,
  certificateExpiryDigestEmail,
  certificateReminderEmail,
  cooperativeStatusEmail,
  farmerInviteEmail,
  farmerStatusEmail,
  passwordResetEmail,
  payoutAlertEmail,
  verificationEmail,
} from "@/modules/notifications/emails";

const BASE = "http://localhost:3000";
const NAME = "A & B <Farmers>";
const ESCAPED = "A &amp; B &lt;Farmers&gt;";
const day = new Date("2031-06-12T12:00:00Z");

type Mail = { subject: string; html: string; text: string };
type Case = {
  name: string;
  mail: () => Mail;
  // The first href in the html, unescaped.
  action: string;
  hero: boolean;
  // A sentence of the template's own copy that must survive.
  keeps: string;
};

const CASES: Case[] = [
  {
    name: "verification",
    mail: () => verificationEmail({ link: `${BASE}/api/auth/verify-email?token=t&callbackURL=%2Fverified` }),
    action: `${BASE}/api/auth/verify-email?token=t&callbackURL=%2Fverified`,
    hero: true,
    keeps: "Welcome to AgroHub.",
  },
  {
    name: "password reset",
    mail: () => passwordResetEmail({ name: NAME, link: `${BASE}/reset-password/tok?callbackURL=%2Freset` }),
    action: `${BASE}/reset-password/tok?callbackURL=%2Freset`,
    hero: false,
    keeps: "The link works for one hour.",
  },
  ...(["verified", "rejected", "suspended", "reinstated"] as const).map((kind) => ({
    name: `cooperative ${kind}`,
    mail: () => cooperativeStatusEmail(kind, { cooperativeName: NAME, reason: "<script>x</script>" }),
    action: `${BASE}/sign-in`,
    hero: kind === "verified" || kind === "reinstated",
    keeps: ESCAPED,
  })),
  {
    name: "farmer invite",
    mail: () => farmerInviteEmail({ cooperativeName: NAME, link: `${BASE}/join/tok_-1` }),
    action: `${BASE}/join/tok_-1`,
    hero: true,
    keeps: "This link is for you only.",
  },
  {
    name: "bank change confirm",
    mail: () => bankChangeConfirmEmail({ ownerName: NAME, link: `${BASE}/bank/confirm?token=abc` }),
    action: `${BASE}/bank/confirm?token=abc`,
    hero: false,
    keeps: "48 hours",
  },
  {
    name: "bank change admin alert",
    mail: () =>
      bankChangeAdminAlertEmail({ ownerName: NAME, accountName: "ADA", bankName: "Access Bank", effectiveAt: day }),
    action: `${BASE}/admin`,
    hero: false,
    keeps: "2031-06-12 12:00 UTC",
  },
  ...(["approved", "rejected", "removed"] as const).map((kind) => ({
    name: `farmer ${kind}`,
    mail: () => farmerStatusEmail(kind, { cooperativeName: NAME, reason: "Too far" }),
    action: `${BASE}/sign-in`,
    hero: kind === "approved",
    keeps: ESCAPED,
  })),
  {
    name: "certificate expired",
    mail: () => certificateExpiredEmail({ cooperativeName: NAME }),
    action: `${BASE}/sign-in`,
    hero: false,
    keeps: "has expired",
  },
  {
    name: "certificate reminder",
    mail: () => certificateReminderEmail({ cooperativeName: NAME, expiresAt: day }),
    action: `${BASE}/sign-in`,
    hero: false,
    keeps: "2031-06-12",
  },
  {
    name: "certificate digest",
    mail: () =>
      certificateExpiryDigestEmail({ reminded: [{ name: NAME, expiresAt: day }], lapsed: [{ name: "Z", expiresAt: day }] }),
    action: `${BASE}/admin/cooperatives`,
    hero: false,
    keeps: "No longer verified because the certificate expired:",
  },
  ...(["FAILED", "BLOCKED", "NO_FUNDS", "STALE", "RECONCILIATION", "REFUND_FAILED"] as const).map((kind) => ({
    name: `payout alert ${kind}`,
    mail: () => payoutAlertEmail({ kind, orderReference: "AB12CD34", amountKobo: 1_250_000, recipientType: "FARMER" }),
    action: `${BASE}/admin/orders`,
    hero: false,
    keeps: "Order AB12CD34",
  })),
  {
    name: "alert",
    mail: () => alertEmail({ subject: "Your payout was sent", sentence: `Your payout for ${NAME} was sent.`, href: `${BASE}/farmer/earnings/o1` }),
    action: `${BASE}/farmer/earnings/o1`,
    hero: false,
    keeps: `Your payout for ${ESCAPED} was sent.`,
  },
];

const unescape = (s: string) => s.replace(/&amp;/g, "&");

describe.each(CASES)("$name email", ({ mail, action, hero, keeps }) => {
  it("renders inside the branded layout and keeps its copy", () => {
    const { subject, html } = mail();
    expect(subject.length).toBeGreaterThan(3);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`src="${BASE}/email/mark@2x.png"`);
    expect(html).toContain(">AgroHub<");
    expect(html).toContain(keeps);
  });

  it("has its action as the first link", () => {
    const first = mail().html.match(/href="([^"]+)"/)?.[1];
    expect(unescape(first ?? "")).toBe(action);
  });

  it(hero ? "shows the hero photo" : "has no hero photo", () => {
    expect(mail().html.includes("/email/hero-cooperative.jpg")).toBe(hero);
  });

  it("uses absolute image URLs with alt text", () => {
    for (const tag of mail().html.match(/<img\b[^>]*>/g) ?? []) {
      expect(tag).toMatch(/src="https?:\/\//);
      expect(tag).toMatch(/alt="[^"]+"/);
    }
  });

  it("escapes names and never says escrow", () => {
    const { subject, html, text } = mail();
    expect(html).not.toContain("<Farmers>");
    expect(html).not.toContain("<script>");
    expect(`${subject} ${html} ${text}`.toLowerCase()).not.toContain("escrow");
    expect(html).not.toContain("undefined");
  });

  it("has a plain-text alternative", () => {
    const { text } = mail();
    expect(text.length).toBeGreaterThan(20);
    // User text is shown decoded (a name may contain "<"), but no template markup may leak.
    expect(text).not.toMatch(/<\/?(p|strong|ul|li|br|a|table|td|div|img)\b/);
    expect(text).toContain(action);
  });
});

describe("fallback link", () => {
  it("is on the credential emails only", () => {
    const withFallback = ["verification", "password reset", "farmer invite", "bank change confirm"];
    for (const c of CASES) {
      expect(c.mail().html.includes("If the button does not work"), c.name).toBe(withFallback.includes(c.name));
    }
  });
});
