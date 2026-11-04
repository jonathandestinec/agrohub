import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env, type Env } from "@/lib/env";
import { ConflictError, UnavailableError, ValidationError } from "@/lib/errors";
import { applyBps } from "@/lib/money";

// Paystack transfer recipients. Shapes checked against Paystack's OpenAPI spec
// (github.com/PaystackOSS/openapi). Account numbers are sent only inside the request to
// Paystack: never logged, never put in an error message, never stored.

export type PaystackConfig = {
  appEnv: Env["APP_ENV"];
  nodeEnv: string | undefined;
  secretKey: string | undefined;
};

export type BankInput = { accountNumber: string; bankCode: string };
export type Bank = { name: string; code: string };

const BASE_URL = "https://api.paystack.co";
const TIMEOUT_MS = 15_000;
const BANK_CACHE_MS = 24 * 3_600_000;
const MAX_BANK_PAGES = 20;

type FakePaystack = {
  // Keyed by `${bankCode}:${accountNumber}`; the value is the account name.
  accounts: Map<string, string>;
  // Recipient codes created, oldest first.
  recipients: string[];
  // Phase 5: transactions by our reference, refunds sent, and switches for failure tests.
  transactions: Map<string, FakeTransaction>;
  refunds: Array<{ reference: string; amountKobo: number; refundId: string }>;
  failNextRefund: boolean;
  down: boolean;
  lastId: number;
  clear(): void;
};

type FakeTransaction = {
  amountKobo: number;
  email: string;
  status: string;
  transactionId: string;
  feesKobo: number;
  paidAt: string | null;
};

// Kept on globalThis so every module instance shares one fake (see src/lib/email.ts).
const globalForPaystack = globalThis as unknown as { agrohubFakePaystack?: FakePaystack };

export const fakePaystack: FakePaystack = (globalForPaystack.agrohubFakePaystack ??= {
  accounts: new Map(),
  recipients: [],
  transactions: new Map(),
  refunds: [],
  failNextRefund: false,
  down: false,
  lastId: 1000,
  clear() {
    this.accounts.clear();
    this.recipients.length = 0;
    this.transactions.clear();
    this.refunds.length = 0;
    this.failNextRefund = false;
    this.down = false;
  },
});

fakePaystack.transactions ??= new Map();
fakePaystack.refunds ??= [];
fakePaystack.lastId ??= 1000;

const FAKE_BANKS: Bank[] = [
  { name: "Access Bank", code: "044" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "United Bank For Africa", code: "033" },
  { name: "Zenith Bank", code: "057" },
];

export function selectPaystack(config: PaystackConfig): "fake" | "live" {
  if (config.appEnv === "local" || config.nodeEnv === "test") return "fake";
  if (config.secretKey) return "live";
  throw new Error(
    `PAYSTACK_SECRET_KEY is required to call Paystack when APP_ENV is ${config.appEnv}`,
  );
}

// NUBAN account numbers are exactly 10 digits; Paystack bank codes are 3 to 6 digits.
export function validateBankInput(input: BankInput): void {
  if (typeof input.accountNumber !== "string" || !/^\d{10}$/.test(input.accountNumber)) {
    throw new ValidationError(
      "Account number must be exactly 10 digits",
      "INVALID_ACCOUNT_NUMBER",
    );
  }
  if (typeof input.bankCode !== "string" || !/^\d{3,6}$/.test(input.bankCode)) {
    throw new ValidationError("Bank code must be 3 to 6 digits", "INVALID_BANK_CODE");
  }
}

function accountNotFound(): ValidationError {
  return new ValidationError("Bank account not found", "BANK_ACCOUNT_NOT_FOUND");
}

// Down, timed out, or refusing for now (429: Paystack test mode allows only a few account
// lookups a day). Typed, so the person is told to try again later.
function unavailable(): UnavailableError {
  return new UnavailableError("PAYSTACK_UNAVAILABLE");
}

// Logs only the endpoint path (no query string) and the status or error name.
function logFailure(path: string, detail: { status?: number; error?: string }): void {
  console.error("paystack request failed", { path, ...detail });
}

async function call(
  config: PaystackConfig,
  path: string,
  // refusal: for payment endpoints a 400, 404 or 422 is Paystack refusing the request
  // (PAYSTACK_REFUSED), not an unknown bank account.
  options: { query?: Record<string, string>; body?: Record<string, unknown>; refusal?: boolean } = {},
): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // The original error can carry the URL (and so the account number): drop it.
    logFailure(path, { error: error instanceof Error ? error.name : "non-Error thrown" });
    throw unavailable();
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    if (options.refusal) {
      let message: unknown;
      try {
        message = ((await response.json()) as { message?: unknown }).message;
      } catch {
        message = undefined;
      }
      logFailure(path, { status: response.status });
      throw refused(message);
    }
    throw accountNotFound();
  }
  if (response.status >= 500 || response.status === 429) {
    logFailure(path, { status: response.status });
    throw unavailable();
  }
  if (!response.ok) {
    logFailure(path, { status: response.status });
    throw new Error("PAYSTACK_REQUEST_FAILED");
  }
  try {
    return await response.json();
  } catch {
    logFailure(path, { error: "invalid JSON" });
    throw new Error("PAYSTACK_BAD_RESPONSE");
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown, path: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    // Never include the body or zod's message: both can echo the account number.
    logFailure(path, { error: "unexpected response shape" });
    throw new Error("PAYSTACK_BAD_RESPONSE");
  }
  return result.data;
}

const resolveResponse = z.object({
  status: z.literal(true),
  data: z.object({ account_name: z.string().min(1) }),
});

const recipientResponse = z.object({
  status: z.literal(true),
  data: z.object({
    recipient_code: z.string().min(1),
    details: z.object({ account_name: z.string().nullable().optional() }).optional(),
  }),
});

const banksResponse = z.object({
  status: z.literal(true),
  data: z.array(
    z.object({
      name: z.string(),
      code: z.string(),
      active: z.boolean().optional(),
      is_deleted: z.boolean().nullable().optional(),
    }),
  ),
  // Unverified: the cursor meta shape. Read defensively; stop on a missing or null next.
  meta: z.object({ next: z.string().nullable().optional() }).passthrough().nullish(),
});

// Resolved names are remembered briefly, so the live lookup on the bank form and the save
// that follows cost one Paystack call (test mode allows only a few a day). Keyed by a hash,
// so the account number itself is not kept. Per server instance; failures are not kept.
const RESOLVE_CACHE_MS = 10 * 60 * 1000;
const RESOLVE_CACHE_MAX = 500;
const resolveCache = new Map<string, { at: number; accountName: string }>();

function resolveKey(input: BankInput): string {
  return createHash("sha256").update(`${input.bankCode}:${input.accountNumber}`).digest("hex");
}

export async function resolveAccountWith(
  config: PaystackConfig,
  input: BankInput,
): Promise<{ accountName: string }> {
  validateBankInput(input);
  if (selectPaystack(config) === "fake") {
    const name = fakePaystack.accounts.get(`${input.bankCode}:${input.accountNumber}`);
    if (!name) throw accountNotFound();
    return { accountName: name };
  }
  const key = resolveKey(input);
  const now = Date.now();
  const cached = resolveCache.get(key);
  if (cached && now - cached.at < RESOLVE_CACHE_MS) return { accountName: cached.accountName };
  const body = await call(config, "/bank/resolve", {
    query: { account_number: input.accountNumber, bank_code: input.bankCode },
  });
  const accountName = parse(resolveResponse, body, "/bank/resolve").data.account_name;
  if (resolveCache.size >= RESOLVE_CACHE_MAX) resolveCache.clear();
  resolveCache.set(key, { at: now, accountName });
  return { accountName };
}

export async function createRecipientWith(
  config: PaystackConfig,
  input: BankInput & { name: string },
): Promise<{ recipientCode: string; accountName: string }> {
  validateBankInput(input);
  if (selectPaystack(config) === "fake") {
    const name = fakePaystack.accounts.get(`${input.bankCode}:${input.accountNumber}`);
    if (!name) throw accountNotFound();
    const recipientCode = `RCP_fake${randomBytes(6).toString("hex")}`;
    fakePaystack.recipients.push(recipientCode);
    return { recipientCode, accountName: name };
  }
  const body = await call(config, "/transferrecipient", {
    body: {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    },
  });
  const { data } = parse(recipientResponse, body, "/transferrecipient");
  return {
    recipientCode: data.recipient_code,
    accountName: data.details?.account_name || input.name,
  };
}

let bankCache: { at: number; banks: Bank[] } | undefined;

/** Test-only: forgets the cached bank list. */
export function resetBankCacheForTests(): void {
  bankCache = undefined;
  resolveCache.clear();
}

export async function listBanksWith(
  config: PaystackConfig,
  now: number = Date.now(),
): Promise<Bank[]> {
  if (bankCache && now - bankCache.at < BANK_CACHE_MS) return bankCache.banks;
  let banks: Bank[];
  if (selectPaystack(config) === "fake") {
    banks = [...FAKE_BANKS];
  } else {
    banks = [];
    let next: string | undefined;
    for (let page = 0; page < MAX_BANK_PAGES; page += 1) {
      const body = await call(config, "/bank", {
        query: {
          country: "nigeria",
          currency: "NGN",
          perPage: "100",
          use_cursor: "true",
          ...(next ? { next } : {}),
        },
      });
      const parsed = parse(banksResponse, body, "/bank");
      for (const bank of parsed.data) {
        if (bank.active === false || bank.is_deleted === true) continue;
        banks.push({ name: bank.name, code: bank.code });
      }
      next = parsed.meta?.next ?? undefined;
      if (!next) break;
    }
  }
  bankCache = { at: now, banks };
  return banks;
}

function currentConfig(): PaystackConfig {
  return {
    appEnv: env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
    secretKey: env.PAYSTACK_SECRET_KEY,
  };
}

export function resolveAccount(input: BankInput): Promise<{ accountName: string }> {
  return resolveAccountWith(currentConfig(), input);
}

export function createRecipient(
  input: BankInput & { name: string },
): Promise<{ recipientCode: string; accountName: string }> {
  return createRecipientWith(currentConfig(), input);
}

export function listBanks(): Promise<Bank[]> {
  return listBanksWith(currentConfig());
}

// ---------------------------------------------------------------------------------------------
// Phase 5: transactions, refunds and webhook signatures. Amounts are integer kobo. The buyer's
// email goes to Paystack inside the request only; it is never logged or put in an error.

export type TransactionInput = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: { orderId: string };
};

export type VerifiedTransaction = {
  status: string;
  amountKobo: number;
  currency: string;
  transactionId: string;
  feesKobo: number;
  channel: string | null;
  paidAt: string | null;
};

// Our references (pay_<cuid>, po_..., a Paystack id) are plain tokens; anything else is refused
// before it reaches a URL path.
const REFERENCE = /^[A-Za-z0-9_.=-]{1,100}$/;

function assertReference(reference: string): void {
  if (!REFERENCE.test(reference)) throw new ValidationError("Invalid reference", "INVALID_REFERENCE");
}

// Paystack messages worth showing an admin. Anything else is dropped: it can echo an email.
const REFUSAL_MESSAGES = ["insufficient balance", "already refunded", "transaction not found"];

function refused(message: unknown): ConflictError {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  const known = REFUSAL_MESSAGES.find((m) => text.includes(m));
  return new ConflictError(known ?? "Paystack refused the request", "PAYSTACK_REFUSED");
}

const initializeResponse = z.object({
  status: z.literal(true),
  data: z.object({ authorization_url: z.string().min(1), access_code: z.string().min(1) }),
});

const verifyResponse = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.union([z.number(), z.string()]),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    fees: z.number().int().nonnegative().nullable().optional(),
    channel: z.string().nullable().optional(),
    paid_at: z.string().nullable().optional(),
  }),
});

const refundResponse = z.object({
  status: z.literal(true),
  data: z.object({ id: z.union([z.number(), z.string()]), status: z.string() }),
});

const transactionsResponse = z.object({
  status: z.literal(true),
  data: z.array(z.object({ id: z.union([z.number(), z.string()]), reference: z.string(), amount: z.number().int() })),
  meta: z.object({ page: z.number().optional(), pageCount: z.number().optional() }).passthrough().nullish(),
});

const MAX_TRANSACTION_PAGES = 20;

// The fake charges what Paystack Nigeria charges for local payments: 1.5%, plus ₦100 from
// ₦2,500 up, capped at ₦2,000.
function fakeFeeKobo(amountKobo: number): number {
  const fee = applyBps(amountKobo, 150) + (amountKobo >= 250_000 ? 10_000 : 0);
  return Math.min(fee, 200_000);
}

function fakeUnavailable(): void {
  if (fakePaystack.down) throw unavailable();
}

export async function initializeTransactionWith(
  config: PaystackConfig,
  input: TransactionInput,
): Promise<{ authorizationUrl: string; accessCode: string }> {
  assertReference(input.reference);
  if (selectPaystack(config) === "fake") {
    fakeUnavailable();
    fakePaystack.transactions.set(input.reference, {
      amountKobo: input.amountKobo,
      email: input.email,
      status: "pending",
      transactionId: String(++fakePaystack.lastId),
      feesKobo: 0,
      paidAt: null,
    });
    return {
      authorizationUrl: `/dev/paystack/checkout?reference=${encodeURIComponent(input.reference)}`,
      accessCode: `fake_${input.reference}`,
    };
  }
  const body = await call(config, "/transaction/initialize", {
    body: {
      email: input.email,
      amount: input.amountKobo,
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      channels: ["card", "bank_transfer", "ussd"],
      metadata: input.metadata,
    },
    refusal: true,
  });
  const { data } = parse(initializeResponse, body, "/transaction/initialize");
  return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
}

export async function verifyTransactionWith(config: PaystackConfig, reference: string): Promise<VerifiedTransaction> {
  assertReference(reference);
  if (selectPaystack(config) === "fake") {
    fakeUnavailable();
    const tx = fakePaystack.transactions.get(reference);
    if (!tx) throw refused("transaction not found");
    return {
      status: tx.status,
      amountKobo: tx.amountKobo,
      currency: "NGN",
      transactionId: tx.transactionId,
      feesKobo: tx.feesKobo,
      channel: tx.status === "success" ? "card" : null,
      paidAt: tx.paidAt,
    };
  }
  const path = `/transaction/verify/${reference}`;
  const { data } = parse(verifyResponse, await call(config, path, { refusal: true }), "/transaction/verify");
  return {
    status: data.status,
    amountKobo: data.amount,
    currency: data.currency,
    transactionId: String(data.id),
    feesKobo: data.fees ?? 0,
    channel: data.channel ?? null,
    paidAt: data.paid_at ?? null,
  };
}

export async function refundTransactionWith(
  config: PaystackConfig,
  input: { reference: string; amountKobo: number },
): Promise<{ refundId: string; status: string }> {
  assertReference(input.reference);
  if (selectPaystack(config) === "fake") {
    fakeUnavailable();
    if (fakePaystack.failNextRefund) {
      fakePaystack.failNextRefund = false;
      throw unavailable();
    }
    const refundId = `fake_refund_${++fakePaystack.lastId}`;
    fakePaystack.refunds.push({ reference: input.reference, amountKobo: input.amountKobo, refundId });
    return { refundId, status: "pending" };
  }
  const body = await call(config, "/refund", {
    body: { transaction: input.reference, amount: input.amountKobo },
    refusal: true,
  });
  const { data } = parse(refundResponse, body, "/refund");
  return { refundId: String(data.id), status: data.status };
}

export async function listTransactionsWith(
  config: PaystackConfig,
  input: { from: Date; to: Date },
): Promise<Array<{ reference: string; amountKobo: number; transactionId: string }>> {
  if (selectPaystack(config) === "fake") {
    fakeUnavailable();
    return [...fakePaystack.transactions.entries()]
      .filter(([, tx]) => {
        if (tx.status !== "success" || !tx.paidAt) return false;
        const at = new Date(tx.paidAt).getTime();
        return at >= input.from.getTime() && at <= input.to.getTime();
      })
      .map(([reference, tx]) => ({ reference, amountKobo: tx.amountKobo, transactionId: tx.transactionId }));
  }
  const found: Array<{ reference: string; amountKobo: number; transactionId: string }> = [];
  for (let page = 1; page <= MAX_TRANSACTION_PAGES; page += 1) {
    const body = await call(config, "/transaction", {
      query: {
        status: "success",
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        perPage: "100",
        page: String(page),
      },
      refusal: true,
    });
    const parsed = parse(transactionsResponse, body, "/transaction");
    for (const tx of parsed.data) {
      found.push({ reference: tx.reference, amountKobo: tx.amount, transactionId: String(tx.id) });
    }
    const pageCount = parsed.meta?.pageCount ?? 1;
    if (parsed.data.length === 0 || page >= pageCount) break;
  }
  return found;
}

/** Paystack signs each webhook with HMAC-SHA512 of the raw body, keyed by the secret key. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac("sha512", secret).update(rawBody).digest("hex"));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Signs the fake's webhooks; never a real key. */
export const FAKE_WEBHOOK_SECRET = "sk_test_fake_webhook";

export function webhookSecretWith(config: PaystackConfig): string {
  if (selectPaystack(config) === "fake") return FAKE_WEBHOOK_SECRET;
  return config.secretKey as string;
}

export function webhookSecret(): string {
  return webhookSecretWith(currentConfig());
}

/** Test and dev helper: signs a body the way Paystack would, with the fake's secret. */
export function fakeWebhook(body: unknown): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: createHmac("sha512", FAKE_WEBHOOK_SECRET).update(rawBody).digest("hex") };
}

/**
 * Test and dev helper: settles a fake transaction as the buyer paying (or failing to) on
 * Paystack's page, and returns the charge.success webhook Paystack would send. amountKobo
 * lets a test make Paystack report a different amount.
 */
export function fakeSettle(
  reference: string,
  outcome: "success" | "failed",
  amountKobo?: number,
  at: Date = new Date(),
): { rawBody: string; signature: string } {
  const tx = fakePaystack.transactions.get(reference);
  if (!tx) throw new Error(`No fake transaction ${reference}`);
  tx.status = outcome;
  if (amountKobo !== undefined) tx.amountKobo = amountKobo;
  tx.feesKobo = outcome === "success" ? fakeFeeKobo(tx.amountKobo) : 0;
  tx.paidAt = outcome === "success" ? at.toISOString() : null;
  return fakeWebhook({
    event: outcome === "success" ? "charge.success" : "charge.failed",
    data: {
      id: Number(tx.transactionId),
      reference,
      status: outcome,
      amount: tx.amountKobo,
      currency: "NGN",
      customer: { email: tx.email },
    },
  });
}

export function initializeTransaction(input: TransactionInput): Promise<{ authorizationUrl: string; accessCode: string }> {
  return initializeTransactionWith(currentConfig(), input);
}

export function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  return verifyTransactionWith(currentConfig(), reference);
}

export function refundTransaction(input: { reference: string; amountKobo: number }): Promise<{ refundId: string; status: string }> {
  return refundTransactionWith(currentConfig(), input);
}

export function listTransactions(input: { from: Date; to: Date }): Promise<Array<{ reference: string; amountKobo: number; transactionId: string }>> {
  return listTransactionsWith(currentConfig(), input);
}
