import { describe, expect, it } from "vitest";
import { payoutOutcomeMessage } from "@/components/payout-outcome";

describe("payoutOutcomeMessage", () => {
  it("says paid when the payout is paid", () => {
    expect(payoutOutcomeMessage({ status: "PAID", failureReason: null })).toEqual({ tone: "good", key: "outcome.PAID" });
  });

  it("says sent when Paystack has the transfer and has not answered yet", () => {
    expect(payoutOutcomeMessage({ status: "SENT", failureReason: null })).toEqual({ tone: "good", key: "outcome.SENT" });
  });

  it("says it waits for the Paystack balance when the payout went back to the queue", () => {
    expect(payoutOutcomeMessage({ status: "QUEUED", failureReason: "NO_FUNDS" })).toEqual({ tone: "warn", key: "outcome.QUEUED" });
  });

  it("says failed with the stored reason in plain words", () => {
    expect(payoutOutcomeMessage({ status: "FAILED", failureReason: "NO_FUNDS" })).toEqual({
      tone: "bad",
      key: "outcome.FAILED",
      reasonKey: "reason.NO_FUNDS",
    });
    expect(payoutOutcomeMessage({ status: "FAILED", failureReason: "REFUSED" })).toMatchObject({ reasonKey: "reason.REFUSED" });
    expect(payoutOutcomeMessage({ status: "FAILED", failureReason: "REVERSED" })).toMatchObject({ reasonKey: "reason.REVERSED" });
  });

  it("falls back to a general reason for a Paystack status it has no words for, or none stored", () => {
    expect(payoutOutcomeMessage({ status: "FAILED", failureReason: "ABANDONED" })).toMatchObject({ reasonKey: "reason.OTHER" });
    expect(payoutOutcomeMessage({ status: "FAILED", failureReason: null })).toMatchObject({ reasonKey: "reason.OTHER" });
  });

  it("says it is still blocked when no payout account exists", () => {
    expect(payoutOutcomeMessage({ status: "BLOCKED", failureReason: null })).toEqual({ tone: "bad", key: "outcome.BLOCKED" });
  });
});
