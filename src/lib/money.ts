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

const BPS_STRING = /^\d{1,5}$/;
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * Parses a stored basis-point string ("300") into an integer from 0 to 10000. The one place
 * a Setting value becomes a number; anything else (decimals, signs, spaces, "3%") is refused.
 */
export function parseBps(value: string): number {
  if (!BPS_STRING.test(value)) throw new RangeError(`Invalid basis points: ${JSON.stringify(value)}`);
  const bps = Number(value);
  if (bps > 10000) throw new RangeError(`Basis points above 10000: ${value}`);
  return bps;
}

/** Converts a percentage typed by a person ("3", "2.5", "0.01") into integer basis points. */
export function percentToBps(percent: string): number {
  const match = PERCENT.exec(percent);
  if (!match) throw new SyntaxError(`Invalid percentage: ${JSON.stringify(percent)}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** The cut a new lot is quoted: the cooperative's own, unless the admin maximum is now lower. */
export function effectiveCutBps(cooperativeCutBps: number, maxCooperativeCutBps: number): number {
  return Math.min(cooperativeCutBps, maxCooperativeCutBps);
}

/** Formats basis points as a percentage: 300 → "3%", 250 → "2.5%", 1 → "0.01%". */
export function formatPercent(bps: number): string {
  assertNonNegativeSafeInt(bps, "bps");
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return `${Math.floor(bps / 100)}${fraction ? `.${fraction}` : ""}%`;
}

/** Writes non-negative kobo as a plain naira amount for a form field: "65000", "43219.87". */
export function nairaInput(kobo: number): string {
  assertNonNegativeSafeInt(kobo, "kobo");
  const value = BigInt(kobo);
  const fraction = value % HUNDRED;
  return fraction === ZERO
    ? (value / HUNDRED).toString()
    : `${(value / HUNDRED).toString()}.${fraction.toString().padStart(2, "0")}`;
}

/** Formats integer kobo as "₦1,500.50" (negatives as "-₦1,500.50"). */
export function formatNaira(kobo: number): string {
  assertSafeInt(kobo, "kobo");
  const abs = BigInt(kobo < 0 ? -kobo : kobo);
  const whole = (abs / HUNDRED).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % HUNDRED).toString().padStart(2, "0");
  return `${kobo < 0 ? "-" : ""}₦${whole}.${fraction}`;
}

/** Formats the change from one price to another: "+₦20.00", "-₦1,000.00", or "₦0.00". */
export function formatNairaChange(fromKobo: number, toKobo: number): string {
  assertSafeInt(fromKobo, "fromKobo");
  assertSafeInt(toKobo, "toKobo");
  const delta = toKobo - fromKobo;
  return `${delta > 0 ? "+" : ""}${formatNaira(delta)}`;
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
 * Every number in free text read as an amount, in kobo: each as naira ("₦43,219.87",
 * "N550", "550.00") and each whole number also as plain kobo ("4321987"). Commas are ignored.
 * Used only to stop a message from naming a private price.
 */
export function amountsIn(text: string): number[] {
  const found = new Set<number>();
  for (const token of numberTokens(text)) {
    if (token.thousands) continue;
    for (const plain of readings(token.body)) {
      const kobo = nairaKobo(plain);
      if (kobo !== null) found.add(kobo);
      if (/^\d+$/.test(plain) && Number.isSafeInteger(Number(plain))) found.add(Number(plain));
    }
  }
  return [...found];
}

/** Whether kobo amount a lies within bps of b (|a - b| <= b * bps / 10000), in integers. */
export function withinBps(a: number, b: number, bps: number): boolean {
  assertNonNegativeSafeInt(a, "a");
  assertNonNegativeSafeInt(b, "b");
  assertNonNegativeSafeInt(bps, "bps");
  const diff = BigInt(a) > BigInt(b) ? BigInt(a) - BigInt(b) : BigInt(b) - BigInt(a);
  return diff * BPS_DENOM <= BigInt(b) * BigInt(bps);
}

/** Amounts written in thousands of naira ("55k", "₦43.2k"), in kobo. Rough by nature. */
export function thousandsIn(text: string): number[] {
  const found = new Set<number>();
  for (const token of numberTokens(text)) {
    if (!token.thousands) continue;
    for (const plain of readings(token.body)) {
      const kobo = nairaKobo(plain);
      if (kobo !== null && Number.isSafeInteger(kobo * 1000)) found.add(kobo * 1000);
    }
  }
  return [...found];
}

// Runs of digits that may be grouped by commas, dots or single spaces, each optionally
// followed by "k" for thousands.
function numberTokens(text: string): Array<{ body: string; thousands: boolean }> {
  const tokens: Array<{ body: string; thousands: boolean }> = [];
  for (const match of text.matchAll(/\d(?:[\d.,]|\s(?=\d))*(\s?k\b)?/gi)) {
    tokens.push({ body: match[0].replace(/\s?k$/i, ""), thousands: match[1] !== undefined });
  }
  return tokens;
}

// A number read both ways it is commonly written: "43,219.87" / "43 219.87" (dot decimal) and
// "43.219,87" (comma decimal).
function readings(body: string): string[] {
  const dotDecimal = body.replace(/[\s,]/g, "");
  const commaDecimal = body.replace(/[\s.]/g, "").replace(",", ".");
  return dotDecimal === commaDecimal ? [dotDecimal] : [dotDecimal, commaDecimal];
}

function nairaKobo(plain: string): number | null {
  try {
    return toKobo(plain);
  } catch {
    // More than two decimals, several decimal points, or too large: not a naira amount.
    return null;
  }
}

/** The sum of non-negative kobo amounts (goods plus delivery, say); RangeError beyond the safe range. */
export function sumKobo(...amounts: number[]): number {
  let total = BigInt(0);
  for (const a of amounts) {
    assertNonNegativeSafeInt(a, "amount");
    total += BigInt(a);
  }
  return toSafeNumber(total, "sum");
}

/** A whole quantity at a per-unit price, in kobo; RangeError beyond the safe integer range. */
export function lineTotalKobo(unitKobo: number, quantity: number): number {
  assertNonNegativeSafeInt(unitKobo, "unitKobo");
  assertNonNegativeSafeInt(quantity, "quantity");
  return toSafeNumber(BigInt(unitKobo) * BigInt(quantity), "line total");
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

export type OrderSplit = {
  goodsKobo: number;
  deliveryKobo: number;
  totalKobo: number;
  cutKobo: number;
  feeKobo: number;
  cooperativePayoutKobo: number;
  farmerKobo: number[];
};

/**
 * What an order of `quantity` units at `unitKobo` is worth to each party, from the lot's
 * locked terms. The cut and the fee come out of the goods (rounded down); the farmers share
 * the rest by contribution; the cooperative also keeps the delivery cost. The cooperative's
 * payout, the fee and the farmers' shares always sum exactly to the total the buyer pays.
 */
export function orderSplit(input: {
  unitKobo: number;
  quantity: number;
  cutBps: number;
  feeBps: number;
  deliveryKobo: number;
  contributions: number[];
}): OrderSplit {
  if (input.contributions.length === 0) throw new RangeError("contributions must not be empty");
  assertNonNegativeSafeInt(input.deliveryKobo, "deliveryKobo");
  const goodsKobo = lineTotalKobo(input.unitKobo, input.quantity);
  const cutKobo = applyBps(goodsKobo, input.cutBps);
  const feeKobo = applyBps(goodsKobo, input.feeBps);
  const farmerKobo = splitByWeights(goodsKobo - cutKobo - feeKobo, input.contributions);
  return {
    goodsKobo,
    deliveryKobo: input.deliveryKobo,
    totalKobo: toSafeNumber(BigInt(goodsKobo) + BigInt(input.deliveryKobo), "total"),
    cutKobo,
    feeKobo,
    cooperativePayoutKobo: cutKobo + input.deliveryKobo,
    farmerKobo,
  };
}

/** The refund for units not delivered (or refunded by an admin), at the order's unit price. */
export function refundForUnits(unitKobo: number, units: number): number {
  return lineTotalKobo(unitKobo, units);
}

/** Paystack's limit on one transfer: ₦10,000,000. */
export const MAX_TRANSFER_KOBO = 1_000_000_000;

/** Splits an amount into as few, as equal as possible, parts of at most maxKobo each. */
export function splitTransferParts(kobo: number, maxKobo: number = MAX_TRANSFER_KOBO): number[] {
  assertNonNegativeSafeInt(kobo, "kobo");
  assertNonNegativeSafeInt(maxKobo, "maxKobo");
  if (maxKobo === 0) throw new RangeError("maxKobo must be positive");
  if (kobo === 0) return [];
  const total = BigInt(kobo);
  const max = BigInt(maxKobo);
  const count = (total + max - ONE) / max;
  const base = total / count;
  const extra = Number(total % count);
  return Array.from({ length: Number(count) }, (_, i) => Number(base) + (i < extra ? 1 : 0));
}

/** An order amount read from a Postgres BIGINT column, as a safe integer of kobo. */
export function koboFromDb(value: bigint): number {
  if (value < -MAX_SAFE || value > MAX_SAFE) throw new RangeError("kobo exceeds the safe integer range");
  return Number(value);
}

/** Kobo for a Postgres BIGINT column: a non-negative safe integer only. */
export function koboToDb(kobo: number): bigint {
  assertNonNegativeSafeInt(kobo, "kobo");
  return BigInt(kobo);
}
