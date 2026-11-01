// Email copy is English-only for now and lives here, not in messages/*.json, which are for UI.

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
