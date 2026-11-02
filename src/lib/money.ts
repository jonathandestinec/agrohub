// Money is integer kobo; percentages are integer basis points (10000 bps = 100%).
// No floating point arithmetic: values are parsed from digit strings and
// computed with BigInt where intermediate products may leave the safe range.

// BigInt() calls rather than literals: tsconfig targets below ES2020.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);
const BPS_DENOM = BigInt(10000);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_NAIRA = /^(\d*)(?:\.(\d{0,2}))?$/;

function assertSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function assertNonNegativeSafeInt(value: number, name: string): void {
  assertSafeInt(value, name);
  if (value < 0) throw new RangeError(`${name} must not be negative`);
}

function toSafeNumber(value: bigint, name: string): number {
  if (value > MAX_SAFE) throw new RangeError(`${name} exceeds the safe integer range`);
  return Number(value);
}

/** Parses a plain decimal naira string ("1500", "1500.5", "1500.50") into integer kobo. */
export function toKobo(naira: string): number {
  const match = DECIMAL_NAIRA.exec(naira);
  const whole = match?.[1] ?? "";
  const fraction = match?.[2] ?? "";
  if (!match || (whole === "" && fraction === "")) {
    throw new SyntaxError(`Invalid naira amount: ${JSON.stringify(naira)}`);
  }
  const kobo = BigInt(whole || "0") * HUNDRED + BigInt(fraction.padEnd(2, "0"));
  return toSafeNumber(kobo, "amount");
}

/** Formats integer kobo as "₦1,500.50" (negatives as "-₦1,500.50"). */
export function formatNaira(kobo: number): string {
  assertSafeInt(kobo, "kobo");
  const abs = BigInt(kobo < 0 ? -kobo : kobo);
  const whole = (abs / HUNDRED).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % HUNDRED).toString().padStart(2, "0");
  return `${kobo < 0 ? "-" : ""}₦${whole}.${fraction}`;
}

/** Returns kobo * bps / 10000, rounded down. Negative kobo is rejected. */
export function applyBps(kobo: number, bps: number): number {
  assertNonNegativeSafeInt(kobo, "kobo");
  assertNonNegativeSafeInt(bps, "bps");
  return toSafeNumber((BigInt(kobo) * BigInt(bps)) / BPS_DENOM, "result");
}

export type SaleBreakdown = {
  grossKobo: number;
  cooperativeKobo: number;
  feeKobo: number;
  takeHomeKobo: number;
  takeHomePerUnitKobo: number;
};

/**
 * What a sale of `quantity` units at `askKobo` each is worth to the farmer after the
 * cooperative's cut and AgroHub's fee (both rounded down, so the farmer keeps the remainder).
 * The parts always sum to the gross. Used by the landing page's example calculator.
 */
export function saleBreakdown(
  askKobo: number,
  quantity: number,
  cutBps: number,
  feeBps: number,
): SaleBreakdown {
  assertNonNegativeSafeInt(askKobo, "askKobo");
  assertNonNegativeSafeInt(quantity, "quantity");
  const grossKobo = toSafeNumber(BigInt(askKobo) * BigInt(quantity), "gross");
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

/**
 * Splits totalKobo in proportion to weights using the largest-remainder method.
 * The parts always sum exactly to totalKobo; leftover kobo go one each to the
 * largest remainders, ties to the lower index. Zero-weight parts get 0.
 */
export function splitByWeights(totalKobo: number, weights: number[]): number[] {
  assertNonNegativeSafeInt(totalKobo, "totalKobo");
  weights.forEach((w, i) => assertNonNegativeSafeInt(w, `weights[${i}]`));
  const sum = weights.reduce((acc, w) => acc + BigInt(w), ZERO);
  if (sum <= ZERO) throw new RangeError("weights must have a positive sum");

  const total = BigInt(totalKobo);
  const parts = weights.map((w) => (total * BigInt(w)) / sum);
  const remainders = weights.map((w) => (total * BigInt(w)) % sum);
  let leftover = total - parts.reduce((acc, p) => acc + p, ZERO);

  const order = weights
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = remainders[a];
      const rb = remainders[b];
      return ra === rb ? a - b : ra > rb ? -1 : 1;
    });
  for (const i of order) {
    if (leftover === ZERO) break;
    parts[i] += ONE;
    leftover -= ONE;
  }
  return parts.map((p) => Number(p));
}
