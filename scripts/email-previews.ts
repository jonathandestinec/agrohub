// Renders every email template with sample data to email-previews/ (git-ignored) and serves those
// files plus public/ over http, so the emails can be checked in a browser with real images and a
// working prefers-color-scheme (file:// pages don't get one in every browser).
//
//   npx tsx scripts/email-previews.ts          # render, then serve on http://localhost:4310
//   npx tsx scripts/email-previews.ts --once   # render only
//
// No secrets: env.ts needs these four values to load, and none of them is used to send anything.

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = 4310;
const ORIGIN = `http://localhost:${PORT}`;
Object.assign(process.env, {
  DATABASE_URL: "postgresql://preview:preview@localhost:5432/preview",
  BETTER_AUTH_SECRET: "preview-only-not-a-secret-0123456789",
  BETTER_AUTH_URL: ORIGIN,
  CRON_SECRET: "preview-only",
  APP_ENV: "local",
});

const ROOT = process.cwd();
const OUT = join(ROOT, "email-previews");

async function render(): Promise<string[]> {
  const e = await import("../src/modules/notifications/emails");
  const name = "Zaria Growers & Sons <Kaduna>";
  const day = new Date("2026-12-01T09:00:00Z");
  const samples: Record<string, { subject: string; html: string; text: string }> = {
    verification: e.verificationEmail({ link: `${ORIGIN}/api/auth/verify-email?token=sample-token&callbackURL=%2Fverified` }),
    "password-reset": e.passwordResetEmail({ name: "Amina Bello", link: `${ORIGIN}/reset-password/sample-token?callbackURL=%2Freset-password` }),
    "farmer-invite": e.farmerInviteEmail({ cooperativeName: name, link: `${ORIGIN}/join/sample-token` }),
    "cooperative-verified": e.cooperativeStatusEmail("verified", { cooperativeName: name }),
    "cooperative-rejected": e.cooperativeStatusEmail("rejected", { cooperativeName: name, reason: "The certificate photo is blurred. Please upload a clearer scan." }),
    "farmer-approved": e.farmerStatusEmail("approved", { cooperativeName: name }),
    "bank-change-confirm": e.bankChangeConfirmEmail({ ownerName: name, link: `${ORIGIN}/bank/confirm?token=sample-token` }),
    "certificate-digest": e.certificateExpiryDigestEmail({ reminded: [{ name, expiresAt: day }], lapsed: [{ name: "Funtua Rice Farmers", expiresAt: day }] }),
    "alert-payment-held": e.alertEmail({ subject: "Your payment is held until delivery is confirmed", sentence: "Your payment for 50 Bag of Maize is held until delivery is confirmed.", href: `${ORIGIN}/buyer/orders/sample` }),
    "admin-payout-failed": e.payoutAlertEmail({ kind: "FAILED", orderReference: "AB12CD34", amountKobo: 1_250_000, recipientType: "FARMER" }),
  };
  mkdirSync(OUT, { recursive: true });
  for (const [file, mail] of Object.entries(samples)) {
    writeFileSync(join(OUT, `${file}.html`), mail.html);
    writeFileSync(join(OUT, `${file}.txt`), `Subject: ${mail.subject}\n\n${mail.text}\n`);
  }
  const links = Object.entries(samples)
    .map(([file, mail]) => `<li><a href="/${file}.html">${file}</a> — ${mail.subject} (<a href="/${file}.txt">text</a>)</li>`)
    .join("");
  writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Email previews</title><ul>${links}</ul>`);
  return Object.keys(samples);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function serve(): void {
  createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^[\\/]+/, "");
    // /email/* comes from public/ (as on the app); everything else from email-previews/.
    const base = path.startsWith("email") && !path.startsWith("email-previews") ? join(ROOT, "public") : OUT;
    const file = join(base, path || "index.html");
    if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }).listen(PORT, () => console.log(`email previews on ${ORIGIN}`));
}

void render().then((names) => {
  console.log(`rendered ${names.length} emails to email-previews/`);
  if (!process.argv.includes("--once")) serve();
});
