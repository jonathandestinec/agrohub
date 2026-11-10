import { ConflictError, UnavailableError } from "@/lib/errors";
import { initiateTransfer, verifyTransfer } from "@/lib/paystack";

export type SendOutcome = "PAID" | "PENDING" | "FAILED" | "NO_FUNDS";
export type CheckOutcome = "PAID" | "PENDING" | "FAILED" | "REVERSED";

/**
 * How payouts reach recipients. One Paystack transfer per payout part today; bulk transfers can
 * come later behind the same interface.
 */
export interface PayoutGateway {
  send(input: { reference: string; amountKobo: number; recipientCode: string; reason: string }): Promise<{
    outcome: SendOutcome;
    transferCode: string | null;
    failureReason: string | null;
  }>;
  check(reference: string): Promise<CheckOutcome>;
}

const FAILED_STATUSES = ["failed", "abandoned", "rejected", "blocked", "not_found"];

function fromStatus(status: string): CheckOutcome {
  if (status === "success") return "PAID";
  if (status === "reversed") return "REVERSED";
  if (FAILED_STATUSES.includes(status)) return "FAILED";
  // pending, otp, processing, queued, received: Paystack still holds it.
  return "PENDING";
}

export const paystackTransferGateway: PayoutGateway = {
  async send(input) {
    try {
      const { transferCode, status } = await initiateTransfer(input);
      const outcome = fromStatus(status);
      if (outcome === "PAID") return { outcome: "PAID", transferCode, failureReason: null };
      if (outcome === "PENDING") return { outcome: "PENDING", transferCode, failureReason: null };
      return { outcome: "FAILED", transferCode, failureReason: status.toUpperCase() };
    } catch (error) {
      if (error instanceof ConflictError && error.message === "insufficient balance") {
        return { outcome: "NO_FUNDS", transferCode: null, failureReason: "NO_FUNDS" };
      }
      if (error instanceof ConflictError) return { outcome: "FAILED", transferCode: null, failureReason: "REFUSED" };
      // Paystack unreachable or answering 5xx: the transfer may or may not exist. It is never
      // sent again under a new reference; it stays "awaiting Paystack" until a check (the
      // webhook or reconciliation) says what happened.
      if (error instanceof UnavailableError) return { outcome: "PENDING", transferCode: null, failureReason: null };
      throw error;
    }
  },
  async check(reference) {
    return fromStatus((await verifyTransfer(reference)).status);
  },
};

export function payoutGateway(): PayoutGateway {
  return paystackTransferGateway;
}
