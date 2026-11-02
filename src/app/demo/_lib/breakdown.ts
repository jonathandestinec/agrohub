import { applyBps } from "@/lib/money";

// Demo only. The real computeBreakdown lands with Phase 3 lots; this keeps the demo's
// numbers in integer kobo through money.ts until then.
export type DemoBreakdown = {
  grossKobo: number;
  cooperativeKobo: number;
  feeKobo: number;
  takeHomeKobo: number;
  takeHomePerUnitKobo: number;
};

export function demoBreakdown(
  askKobo: number,
  quantity: number,
  cutBps: number,
  feeBps: number,
): DemoBreakdown {
  const grossKobo = askKobo * quantity;
  const cooperativeKobo = applyBps(grossKobo, cutBps);
  const feeKobo = applyBps(grossKobo, feeBps);
  return {
    grossKobo,
    cooperativeKobo,
    feeKobo,
    takeHomeKobo: grossKobo - cooperativeKobo - feeKobo,
    takeHomePerUnitKobo: askKobo - applyBps(askKobo, cutBps) - applyBps(askKobo, feeBps),
  };
}
