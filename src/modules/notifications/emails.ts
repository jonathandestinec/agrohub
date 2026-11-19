// Email copy is English-only for now and lives here, not in messages/*.json, which are for UI.
// Every template writes its body as bare <p>/<ul>/<li>/<strong> html and hands it to
// renderEmail (email-layout.ts), which adds the branded wrapper, the button and the plain text.

import { formatLagosWat } from "@/lib/lagos-date";
import { formatNaira } from "@/lib/money";
import { appUrl, escapeHtml, renderEmail } from "./email-layout";

export { escapeHtml } from "./email-layout";

export type Email = { subject: string; html: string; text: string };

export type StatusEmailKind =
  | "verified"
  | "rejected"
  | "suspended"
  | "reinstated";

export type StatusEmailInput = { cooperativeName: string; reason?: string };

const signIn = () => ({ label: "Sign in to AgroHub", href: appUrl("/sign-in") });

// One layout for every event email: the same sentence the in-app bell shows, plus a link to the page.
export function alertEmail(input: {
  subject: string;
  sentence: string;
  href: string;
}): Email {
  return {
    subject: input.subject,
    ...renderEmail({
      preheader: input.sentence,
      bodyHtml: `<p>${escapeHtml(input.sentence)}</p>`,
      action: { label: "Open in AgroHub", href: input.href },
    }),
  };
}

export function verificationEmail(input: { link: string }): Email {
  return {
    subject: "Verify your AgroHub email address",
    ...renderEmail({
      preheader: "Verify your email to finish signing up for AgroHub.",
      bodyHtml: `<p>Welcome to AgroHub.</p><p>Verify your email address to finish signing up.</p>`,
      action: { label: "Verify your email address", href: input.link },
      afterHtml: `<p>If you did not sign up, you can ignore this email.</p>`,
      fallbackLink: true,
      hero: "cooperative",
    }),
  };
}

export function passwordResetEmail(input: {
  name: string;
  link: string;
}): Email {
  const name = escapeHtml(input.name);
  return {
    subject: "Reset your AgroHub password",
    ...renderEmail({
      preheader: "Choose a new password for AgroHub. The link works for one hour.",
      bodyHtml: `<p>Hello ${name},</p><p>We got a request to reset your AgroHub password. The link works for one hour.</p>`,
      action: { label: "Choose a new password", href: input.link },
      afterHtml: `<p>If you did not ask for this, you can ignore this email and your password stays the same.</p>`,
      fallbackLink: true,
    }),
  };
}

export function cooperativeStatusEmail(
  kind: StatusEmailKind,
  input: StatusEmailInput,
): Email {
  const name = escapeHtml(input.cooperativeName);
  const reason = input.reason ? escapeHtml(input.reason) : null;
  const reasonLine = (label: string) =>
    reason ? `<p><strong>${label}</strong> ${reason}</p>` : "";
  const mail = (subject: string, preheader: string, bodyHtml: string, hero = false): Email => ({
    subject,
    ...renderEmail({ preheader, bodyHtml, action: signIn(), hero: hero ? "cooperative" : undefined }),
  });

  switch (kind) {
    case "verified":
      return mail(
        "Your cooperative is verified on AgroHub",
        `${input.cooperativeName} is verified. You can now accept farmers and start selling.`,
        `<p>Good news. <strong>${name}</strong> has been verified on AgroHub.</p><p>You can now accept farmers and start selling.</p>`,
        true,
      );
    case "rejected":
      return mail(
        "Changes needed for your AgroHub cooperative",
        "We need some changes before we can verify your cooperative.",
        `<p>We reviewed <strong>${name}</strong> and need some changes before we can verify it.</p>${reasonLine("What to change:")}<p>Sign in, upload the updated documents and we will review again.</p>`,
      );
    case "suspended":
      return mail(
        "Your AgroHub cooperative is suspended",
        `${input.cooperativeName} has been suspended on AgroHub.`,
        `<p><strong>${name}</strong> has been suspended on AgroHub. It cannot sell or accept farmers until it is reinstated.</p>${reasonLine("Reason:")}<p>Please contact AgroHub support if you have questions.</p>`,
      );
    case "reinstated":
      return mail(
        "Your AgroHub cooperative is reinstated",
        `${input.cooperativeName} is verified again on AgroHub.`,
        `<p><strong>${name}</strong> has been reinstated on AgroHub and is verified again.</p>`,
        true,
      );
  }
}

// ---- Farmer invites. The link is the credential; callers must never log it. ----

export function farmerInviteEmail(input: {
  cooperativeName: string;
  link: string;
}): Email {
  const name = escapeHtml(input.cooperativeName);
  return {
    subject: "You are invited to join a cooperative on AgroHub",
    ...renderEmail({
      preheader: `${input.cooperativeName} has invited you to sell with them on AgroHub.`,
      bodyHtml: `<p><strong>${name}</strong> has invited you to join them on AgroHub, where farmers in the cooperative sell their produce together.</p>`,
      action: { label: "Accept the invitation", href: input.link },
      afterHtml: `<p>This link is for you only. If it does not work, ask your cooperative officer for a new one.</p>`,
      fallbackLink: true,
      hero: "cooperative",
    }),
  };
}

// ---- Bank account changes. Never include an account number. ----

export function bankChangeConfirmEmail(input: {
  ownerName: string;
  link: string;
}): Email {
  const name = escapeHtml(input.ownerName);
  return {
    subject: "Confirm the new bank account for your AgroHub payouts",
    ...renderEmail({
      preheader: "Confirm the change to where your AgroHub payouts are sent.",
      bodyHtml: `<p>Someone asked to change the bank account that receives payouts for <strong>${name}</strong> on AgroHub.</p>`,
      action: { label: "Confirm the new bank account", href: input.link },
      afterHtml: `<p>The new account takes effect 48 hours after you confirm. Payouts made before then go to the current account. This link works once and expires in 24 hours.</p><p>If you did not ask for this, do not confirm. Sign in and change your password, then contact AgroHub support.</p>`,
      fallbackLink: true,
    }),
  };
}

// Bank data (holder, bank, number) leaves the server only through views.ts mappers, so this email
// names who and when only. Admins see the current account on the cooperative's admin page.
export function bankChangeAdminAlertEmail(input: {
  ownerName: string;
  effectiveAt: Date;
}): Email {
  const at = formatLagosWat(input.effectiveAt);
  return {
    subject: "AgroHub alert: a payout bank account is changing",
    ...renderEmail({
      preheader: `A confirmed payout account change takes effect at ${at}.`,
      bodyHtml: `<p>A confirmed payout account change for <strong>${escapeHtml(input.ownerName)}</strong> takes effect at ${at}.</p><p>If you did not expect this change, contact them before then.</p>`,
      action: { label: "Open AgroHub admin", href: appUrl("/admin") },
    }),
  };
}

// ---- Farmer membership decisions. Reasons are written by an officer and escaped. ----

export type FarmerStatusEmailKind = "approved" | "rejected" | "removed";

export function farmerStatusEmail(
  kind: FarmerStatusEmailKind,
  input: { cooperativeName: string; reason?: string },
): Email {
  const name = escapeHtml(input.cooperativeName);
  const reasonLine = input.reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>`
    : "";
  const mail = (subject: string, preheader: string, bodyHtml: string, hero = false): Email => ({
    subject,
    ...renderEmail({ preheader, bodyHtml, action: signIn(), hero: hero ? "cooperative" : undefined }),
  });
  switch (kind) {
    case "approved":
      return mail(
        "You have been approved on AgroHub",
        `You are now a member of ${input.cooperativeName} on AgroHub.`,
        `<p>Good news. The officer of <strong>${name}</strong> has approved you as a member on AgroHub.</p><p>Sign in to see your farmer page.</p>`,
        true,
      );
    case "rejected":
      return mail(
        "Your request to join a cooperative was not approved",
        `Your request to join ${input.cooperativeName} was not approved.`,
        `<p>The officer of <strong>${name}</strong> did not approve your request to join.</p>${reasonLine}<p>If you think this is a mistake, please speak to your officer.</p>`,
      );
    case "removed":
      return mail(
        "You have been removed from a cooperative on AgroHub",
        `You have been removed from ${input.cooperativeName} on AgroHub.`,
        `<p>The officer of <strong>${name}</strong> has removed you from the cooperative on AgroHub.</p>${reasonLine}<p>Your records are kept for accounting. If you think this is a mistake, please speak to your officer.</p>`,
      );
  }
}

// ---- Certificate expiry. Names are escaped; dates are UTC calendar dates. ----

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function certificateExpiredEmail(input: { cooperativeName: string }): Email {
  const name = escapeHtml(input.cooperativeName);
  return {
    subject: "Your AgroHub registration certificate has expired",
    ...renderEmail({
      preheader: "Upload the renewed certificate so the cooperative can be verified again.",
      bodyHtml: `<p>The registration certificate for <strong>${name}</strong> has expired, so the cooperative is no longer verified on AgroHub.</p><p>Sign in, upload the renewed certificate and we will review it again.</p>`,
      action: signIn(),
    }),
  };
}

export function certificateReminderEmail(input: {
  cooperativeName: string;
  expiresAt: Date;
}): Email {
  const name = escapeHtml(input.cooperativeName);
  return {
    subject: "Your AgroHub registration certificate expires soon",
    ...renderEmail({
      preheader: `The registration certificate expires on ${formatDay(input.expiresAt)}.`,
      bodyHtml: `<p>The registration certificate for <strong>${name}</strong> expires on ${formatDay(input.expiresAt)}.</p><p>Upload the renewed certificate before then so the cooperative stays verified on AgroHub.</p>`,
      action: signIn(),
    }),
  };
}

export type CertificateDigestEntry = { name: string; expiresAt: Date };

export function certificateExpiryDigestEmail(input: {
  reminded: CertificateDigestEntry[];
  lapsed: CertificateDigestEntry[];
}): Email {
  const list = (entries: CertificateDigestEntry[]) =>
    `<ul>${entries
      .map(
        (entry) =>
          `<li>${escapeHtml(entry.name)} (certificate date ${formatDay(entry.expiresAt)})</li>`,
      )
      .join("")}</ul>`;
  const lapsed = input.lapsed.length
    ? `<p>No longer verified because the certificate expired:</p>${list(input.lapsed)}`
    : "";
  const reminded = input.reminded.length
    ? `<p>Reminded that the certificate expires within 30 days:</p>${list(input.reminded)}`
    : "";
  return {
    subject: "AgroHub certificate expiry digest",
    ...renderEmail({
      preheader: `${input.lapsed.length} lapsed, ${input.reminded.length} reminded today.`,
      bodyHtml: `${lapsed}${reminded}`,
      action: { label: "Open cooperatives", href: appUrl("/admin/cooperatives") },
    }),
  };
}

// ---- Payment and payout alerts for admins. Ids, amounts and kinds only: never an account,
// a recipient code or a person's name. ----

export type PayoutAlertKind = "FAILED" | "BLOCKED" | "NO_FUNDS" | "STALE" | "RECONCILIATION" | "REFUND_FAILED";

const ALERT_LINES: Record<PayoutAlertKind, { subject: string; body: string }> = {
  FAILED: { subject: "a payout failed", body: "Paystack reported a payout transfer as failed. It will not be sent again until an admin retries it." },
  BLOCKED: { subject: "a payout is blocked", body: "A payout could not be queued because the recipient has no payout account. It waits for an admin." },
  NO_FUNDS: { subject: "the Paystack balance is too low for payouts", body: "Paystack refused a payout three times for insufficient balance. It is tried again daily." },
  STALE: { subject: "a payout is still awaiting Paystack", body: "A transfer has been awaiting Paystack for more than 3 days. Check it on the Paystack dashboard." },
  RECONCILIATION: { subject: "reconciliation found a mismatch", body: "The daily reconciliation found a difference between AgroHub and Paystack." },
  REFUND_FAILED: { subject: "a refund failed", body: "Paystack reported a refund to a buyer as failed. Refund the buyer by hand and record it." },
};

export function payoutAlertEmail(input: {
  kind: PayoutAlertKind;
  orderReference: string;
  amountKobo: number;
  recipientType: string;
  detail?: string;
}): Email {
  const line = ALERT_LINES[input.kind];
  const amount = formatNaira(input.amountKobo);
  const facts = `Order ${input.orderReference} · ${amount} · ${input.recipientType}${input.detail ? ` · ${input.detail}` : ""}`;
  return {
    subject: `AgroHub alert: ${line.subject}`,
    ...renderEmail({
      preheader: line.body,
      bodyHtml: `<p>${escapeHtml(line.body)}</p><p>${escapeHtml(facts)}</p><p>Open the admin order queue to act on it.</p>`,
      action: { label: "Open the order queue", href: appUrl("/admin/orders") },
    }),
  };
}
