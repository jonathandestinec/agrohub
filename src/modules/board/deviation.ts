// How far a farmer's asking price may sit from the board price before the lot form shows
// its neutral warning. Starting default 20%; a Setting can replace it later.
export const DEFAULT_DEVIATION_THRESHOLD_BPS = 2000;

export type Deviation = "OK" | "HIGH" | "LOW";

function assertNonNegativeSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

/**
 * Compares an asking price with the board price. HIGH or LOW only when the gap is more
 * than thresholdBps of the board price; exactly at the threshold is OK. Cross-multiplied
 * in BigInt, so there is no division and no float.
 */
export function priceDeviation(askKobo: number, boardKobo: number, thresholdBps: number): Deviation {
  assertNonNegativeSafeInt(askKobo, "askKobo");
  assertNonNegativeSafeInt(boardKobo, "boardKobo");
  assertNonNegativeSafeInt(thresholdBps, "thresholdBps");
  if (boardKobo === 0) throw new RangeError("boardKobo must be positive");

  const ask = BigInt(askKobo);
  const board = BigInt(boardKobo);
  const allowed = board * BigInt(thresholdBps);
  const denom = BigInt(10000);
  if ((ask - board) * denom > allowed) return "HIGH";
  if ((board - ask) * denom > allowed) return "LOW";
  return "OK";
}
