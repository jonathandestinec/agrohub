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
