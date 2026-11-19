// One branded layout for every email AgroHub sends. Pure: no I/O. Email clients ignore most CSS,
// so the layout is tables with inline styles; the one <style> block only adds dark mode (Apple
// Mail) and the small-screen width. Colours come from src/styles/tokens.css. Images are PNG/JPEG
// in public/email/, linked by absolute URL. The header mark is not a link, so the first href in
// every email is its action (tests read the first href).

import { env } from "@/lib/env";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// An absolute URL on the app for a path such as "/sign-in" or "/email/mark@2x.png".
export function appUrl(path: string): string {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}${path}`;
}

export type EmailAction = { label: string; href: string };
export type EmailHero = "cooperative";

export type EmailContent = {
  // The inbox preview line. Hidden in the body, never in the plain text.
  preheader: string;
  // Escaped html of bare <p>, <ul>, <li>, <strong> and <br> tags, shown above the button.
  bodyHtml: string;
  // Same rules, shown below the button.
  afterHtml?: string;
  // Raw label and URL; escaped here.
  action?: EmailAction;
  // Repeat the action URL as a copyable link under the button (credential emails).
  fallbackLink?: boolean;
  hero?: EmailHero;
};

const HEROES: Record<EmailHero, { src: string; alt: string; credit: string }> = {
  cooperative: {
    src: "/email/hero-cooperative.jpg",
    alt: "Members of a farmer cooperative seated together at a meeting",
    credit: "Photo: USAID in Africa, public domain.",
  },
};

const C = {
  ground: "#e9eae3",
  paper: "#ffffff",
  ink: "#10140f",
  inkSoft: "#4a5148",
};

const FONT = "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.ink};`;
const UL = `margin:0 0 16px;padding:0 0 0 20px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.ink};`;
const LI = `margin:0 0 4px;`;
const SOFT = `margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.inkSoft};`;

const TAGLINE = "AgroHub · Sell together. Get paid on delivery.";
const REASON = "You got this email because of your AgroHub account or an invitation to join it.";

const STYLE = `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ah-ground { background-color: #10140f !important; }
  .ah-card { background-color: #1b211a !important; }
  .ah-text p, .ah-text ul, .ah-text li, .ah-text strong, .ah-word { color: #f3f7ef !important; }
  .ah-soft p, .ah-soft a { color: #b9c0b6 !important; }
  .ah-btn-cell, .ah-btn { background-color: #dcef6a !important; }
  .ah-btn { color: #1a2004 !important; }
}
@media (max-width: 620px) {
  .ah-container { width: 100% !important; }
  .ah-pad { padding-left: 24px !important; padding-right: 24px !important; }
  .ah-hero { width: 100% !important; height: auto !important; }
}
</style>`;

// Adds the inline styles to the bare tags templates write.
function styleBody(html: string): string {
  return html
    .replaceAll("<p>", `<p style="${P}">`)
    .replaceAll("<ul>", `<ul style="${UL}">`)
    .replaceAll("<li>", `<li style="${LI}">`)
    .replaceAll("<strong>", `<strong style="font-weight:600;">`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

// Plain text from the bare-tag html templates write. Entities are decoded in one pass, so
// "&amp;lt;" becomes "&lt;", not "<".
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<li[^>]*>/g, "- ")
    .replace(/<\/li>/g, "\n")
    .replace(/<\/ul>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name])
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function button(action: EmailAction): string {
  const href = escapeHtml(action.href);
  const label = escapeHtml(action.label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:separate;"><tr><td class="ah-btn-cell" bgcolor="${C.ink}" style="background-color:${C.ink};border-radius:9999px;mso-padding-alt:12px 28px;"><a class="ah-btn" href="${href}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:${C.paper};background-color:${C.ink};text-decoration:none;border-radius:9999px;">${label}</a></td></tr></table>`;
}

function fallback(action: EmailAction): string {
  const href = escapeHtml(action.href);
  return `<div class="ah-soft"><p style="${SOFT}">If the button does not work, copy this link into your browser:<br><a href="${href}" target="_blank" style="color:${C.inkSoft};text-decoration:underline;word-break:break-all;">${href}</a></p></div>`;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const hero = content.hero ? HEROES[content.hero] : null;
  const action = content.action;

  const heroRow = hero
    ? `<tr><td style="padding:0;font-size:0;line-height:0;"><img class="ah-hero" src="${escapeHtml(appUrl(hero.src))}" width="600" height="240" alt="${escapeHtml(hero.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:24px 24px 0 0;"></td></tr>`
    : "";

  const inner = [
    `<div class="ah-text">${styleBody(content.bodyHtml)}</div>`,
    action ? button(action) : "",
    content.afterHtml ? `<div class="ah-text">${styleBody(content.afterHtml)}</div>` : "",
    action && content.fallbackLink ? fallback(action) : "",
  ].join("");

  const credit = hero ? `<p style="${SOFT}">${escapeHtml(hero.credit)}</p>` : "";

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>AgroHub</title>
${STYLE}
</head>
<body class="ah-ground" style="margin:0;padding:0;background-color:${C.ground};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;opacity:0;color:${C.ground};">${escapeHtml(content.preheader)}</div>
<table role="presentation" class="ah-ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.ground};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="ah-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td class="ah-pad" style="padding:0 40px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${escapeHtml(appUrl("/email/mark@2x.png"))}" width="40" height="40" alt="AgroHub" style="display:block;width:40px;height:40px;border:0;"></td>
<td class="ah-word" style="vertical-align:middle;font-family:${FONT};font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:${C.ink};">AgroHub</td>
</tr></table>
</td></tr>
<tr><td class="ah-card" style="background-color:${C.paper};border-radius:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${heroRow}
<tr><td class="ah-pad" style="padding:36px 40px 20px;">${inner}</td></tr>
</table>
</td></tr>
<tr><td class="ah-pad ah-soft" style="padding:24px 40px 0;">
<p style="${SOFT}">${escapeHtml(TAGLINE)}</p>
<p style="${SOFT}">${escapeHtml(REASON)}</p>
${credit}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    htmlToText(content.bodyHtml),
    action ? `${action.label}: ${action.href}` : "",
    content.afterHtml ? htmlToText(content.afterHtml) : "",
    TAGLINE,
    REASON,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}
