import type { BankChangeRequest } from "@/generated/prisma/client";

// What anyone outside the server sees of a payout account: bank and account name only.
// Recipient codes and confirmation tokens are never part of a view.
export type BankAccountView = {
  bankName: string | null;
  accountName: string | null;
  change:
    | { state: "AWAITING_CONFIRMATION"; effectiveAt: null }
    | { state: "CONFIRMED"; effectiveAt: string }
    | null;
};

export function toBankAccountView(
  current: { bankName: string | null; accountName: string | null },
  pending: Pick<BankChangeRequest, "confirmedAt" | "effectiveAt"> | null,
): BankAccountView {
  let change: BankAccountView["change"] = null;
  if (pending) {
    change =
      pending.confirmedAt && pending.effectiveAt
        ? { state: "CONFIRMED", effectiveAt: pending.effectiveAt.toISOString() }
        : { state: "AWAITING_CONFIRMATION", effectiveAt: null };
  }
  return { bankName: current.bankName, accountName: current.accountName, change };
}

// Effective times are shown in Nigerian time with the zone name, e.g. "12 Jun 2031, 13:00 WAT".
export function formatEffectiveAt(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
    timeZoneName: "short",
  }).format(new Date(iso));
}
