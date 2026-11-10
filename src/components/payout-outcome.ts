// Pure: what to tell an admin after a payout action, from the payout's state afterwards.
// `key` and `reasonKey` are message keys under admin.payouts.
export type PayoutOutcomeInput = { status: "QUEUED" | "SENT" | "PAID" | "FAILED" | "BLOCKED"; failureReason: string | null };
export type PayoutOutcomeMessage = {
  tone: "good" | "warn" | "bad";
  key: `outcome.${PayoutOutcomeInput["status"]}`;
  reasonKey?: `reason.${(typeof REASONS)[number] | "OTHER"}`;
};

// Reasons the payments module stores (NO_FUNDS and REFUSED are its own; FAILED and REVERSED
// are Paystack's answer). Anything else, such as ABANDONED, gets the general wording.
const REASONS = ["NO_FUNDS", "REFUSED", "FAILED", "REVERSED"] as const;

export function payoutOutcomeMessage(outcome: PayoutOutcomeInput): PayoutOutcomeMessage {
  switch (outcome.status) {
    case "PAID":
      return { tone: "good", key: "outcome.PAID" };
    case "SENT":
      return { tone: "good", key: "outcome.SENT" };
    case "QUEUED":
      return { tone: "warn", key: "outcome.QUEUED" };
    case "BLOCKED":
      return { tone: "bad", key: "outcome.BLOCKED" };
    case "FAILED": {
      const known = REASONS.find((r) => r === outcome.failureReason);
      return { tone: "bad", key: "outcome.FAILED", reasonKey: `reason.${known ?? "OTHER"}` };
    }
  }
}
