// Email copy is English-only for now and lives here, not in messages/*.json, which are for UI.

import { formatNaira } from "@/lib/money";

export type StatusEmailKind =
  | "verified"
  | "rejected"
  | "suspended"
  | "reinstated";

export type StatusEmailInput = { cooperativeName: string; reason?: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function cooperativeStatusEmail(
  kind: StatusEmailKind,
  input: StatusEmailInput,
): { subject: string; html: string } {
  const name = escapeHtml(input.cooperativeName);
  const reason = input.reason ? escapeHtml(input.reason) : null;
  const reasonLine = (label: string) =>
    reason ? `<p><strong>${label}</strong> ${reason}</p>` : "";

  switch (kind) {
    case "verified":
      return {
        subject: "Your cooperative is verified on AgroHub",
        html: `<p>Good news. <strong>${name}</strong> has been verified on AgroHub.</p><p>You can now accept farmers and start selling.</p>`,
      };
    case "rejected":
      return {
        subject: "Changes needed for your AgroHub cooperative",
        html: `<p>We reviewed <strong>${name}</strong> and need some changes before we can verify it.</p>${reasonLine("What to change:")}<p>Sign in, upload the updated documents and we will review again.</p>`,
      };
    case "suspended":
      return {
        subject: "Your AgroHub cooperative is suspended",
        html: `<p><strong>${name}</strong> has been suspended on AgroHub. It cannot sell or accept farmers until it is reinstated.</p>${reasonLine("Reason:")}<p>Please contact AgroHub support if you have questions.</p>`,
      };
    case "reinstated":
      return {
        subject: "Your AgroHub cooperative is reinstated",
        html: `<p><strong>${name}</strong> has been reinstated on AgroHub and is verified again.</p>`,
      };
  }
}

// ---- Farmer invites. The link is the credential; callers must never log it. ----

export function farmerInviteEmail(input: {
  cooperativeName: string;
  link: string;
}): { subject: string; html: string } {
  const name = escapeHtml(input.cooperativeName);
  const link = escapeHtml(input.link);
  return {
    subject: "You are invited to join a cooperative on AgroHub",
    html: `<p><strong>${name}</strong> has invited you to join them on AgroHub, where farmers in the cooperative sell their produce together.</p><p><a href="${link}">Accept the invitation</a></p><p>This link is for you only. If it does not work, ask your cooperative officer for a new one.</p>`,
  };
}

// ---- Bank account changes. Never include an account number. ----

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function bankChangeConfirmEmail(input: {
  ownerName: string;
  link: string;
}): { subject: string; html: string } {
  const name = escapeHtml(input.ownerName);
  const link = escapeHtml(input.link);
  return {
    subject: "Confirm the new bank account for your AgroHub payouts",
    html: `<p>Someone asked to change the bank account that receives payouts for <strong>${name}</strong> on AgroHub.</p><p><a href="${link}">Confirm the new bank account</a></p><p>The new account takes effect 48 hours after you confirm. Payouts made before then go to the current account. This link works once and expires in 24 hours.</p><p>If you did not ask for this, do not confirm. Sign in and change your password, then contact AgroHub support.</p>`,
  };
}

export function bankChangeAdminAlertEmail(input: {
  ownerName: string;
  accountName: string;
  bankName: string;
  effectiveAt: Date;
}): { subject: string; html: string } {
  return {
    subject: "AgroHub alert: a payout bank account is changing",
    html: `<p>A confirmed bank account change for <strong>${escapeHtml(input.ownerName)}</strong> takes effect at ${formatUtc(input.effectiveAt)}.</p><p>New account name: ${escapeHtml(input.accountName)}<br>Bank: ${escapeHtml(input.bankName)}</p><p>If this looks wrong, act before it takes effect.</p>`,
  };
}

// ---- Farmer membership decisions. Reasons are written by an officer and escaped. ----

export type FarmerStatusEmailKind = "approved" | "rejected" | "removed";

export function farmerStatusEmail(
  kind: FarmerStatusEmailKind,
  input: { cooperativeName: string; reason?: string },
): { subject: string; html: string } {
  const name = escapeHtml(input.cooperativeName);
  const reasonLine = input.reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(input.reason)}</p>`
    : "";
  switch (kind) {
    case "approved":
      return {
        subject: "You have been approved on AgroHub",
        html: `<p>Good news. The officer of <strong>${name}</strong> has approved you as a member on AgroHub.</p><p>Sign in to see your farmer page.</p>`,
      };
    case "rejected":
      return {
        subject: "Your request to join a cooperative was not approved",
        html: `<p>The officer of <strong>${name}</strong> did not approve your request to join.</p>${reasonLine}<p>If you think this is a mistake, please speak to your officer.</p>`,
      };
    case "removed":
      return {
        subject: "You have been removed from a cooperative on AgroHub",
        html: `<p>The officer of <strong>${name}</strong> has removed you from the cooperative on AgroHub.</p>${reasonLine}<p>Your records are kept for accounting. If you think this is a mistake, please speak to your officer.</p>`,
      };
  }
}

// ---- Certificate expiry. Names are escaped; dates are UTC calendar dates. ----

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function certificateExpiredEmail(input: { cooperativeName: string }): {
  subject: string;
  html: string;
} {
  const name = escapeHtml(input.cooperativeName);
  return {
    subject: "Your AgroHub registration certificate has expired",
    html: `<p>The registration certificate for <strong>${name}</strong> has expired, so the cooperative is no longer verified on AgroHub.</p><p>Sign in, upload the renewed certificate and we will review it again.</p>`,
  };
}

export function certificateReminderEmail(input: {
  cooperativeName: string;
  expiresAt: Date;
}): { subject: string; html: string } {
  const name = escapeHtml(input.cooperativeName);
  return {
    subject: "Your AgroHub registration certificate expires soon",
    html: `<p>The registration certificate for <strong>${name}</strong> expires on ${formatDay(input.expiresAt)}.</p><p>Upload the renewed certificate before then so the cooperative stays verified on AgroHub.</p>`,
  };
}

export type CertificateDigestEntry = { name: string; expiresAt: Date };

export function certificateExpiryDigestEmail(input: {
  reminded: CertificateDigestEntry[];
  lapsed: CertificateDigestEntry[];
}): { subject: string; html: string } {
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
    html: `${lapsed}${reminded}`,
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
}): { subject: string; text: string; html: string } {
  const line = ALERT_LINES[input.kind];
  const amount = formatNaira(input.amountKobo);
  const facts = `Order ${input.orderReference} · ${amount} · ${input.recipientType}${input.detail ? ` · ${input.detail}` : ""}`;
  return {
    subject: `AgroHub alert: ${line.subject}`,
    text: `${line.body}\n${facts}\nOpen the admin order queue to act on it.`,
    html: `<p>${escapeHtml(line.body)}</p><p>${escapeHtml(facts)}</p><p>Open the admin order queue to act on it.</p>`,
  };
}
