import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { env, type Env } from "@/lib/env";
import { UnavailableError, ValidationError } from "@/lib/errors";

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
  clear(): void;
};

// Kept on globalThis so every module instance shares one fake (see src/lib/email.ts).
const globalForPaystack = globalThis as unknown as { agrohubFakePaystack?: FakePaystack };

export const fakePaystack: FakePaystack = (globalForPaystack.agrohubFakePaystack ??= {
  accounts: new Map(),
  recipients: [],
  clear() {
    this.accounts.clear();
    this.recipients.length = 0;
  },
});

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
  options: { query?: Record<string, string>; body?: Record<string, string> } = {},
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
