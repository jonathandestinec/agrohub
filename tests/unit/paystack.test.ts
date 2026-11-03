import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnavailableError, ValidationError } from "@/lib/errors";
import {
  createRecipient,
  createRecipientWith,
  fakePaystack,
  listBanks,
  listBanksWith,
  resetBankCacheForTests,
  resolveAccount,
  resolveAccountWith,
  selectPaystack,
  type PaystackConfig,
} from "@/lib/paystack";

const ACCOUNT = "0123456789";
const live: PaystackConfig = {
  appEnv: "staging",
  nodeEnv: "production",
  secretKey: "sk_test_abc123",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
const logSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    logSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
  resetBankCacheForTests();
  fakePaystack.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const spy of logSpies.splice(0)) spy.mockRestore();
});

function loggedText(): string {
  return JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

describe("selectPaystack", () => {
  it("uses the fake locally and in tests", () => {
    expect(selectPaystack({ appEnv: "local", nodeEnv: "development", secretKey: undefined })).toBe("fake");
    expect(selectPaystack({ appEnv: "staging", nodeEnv: "test", secretKey: undefined })).toBe("fake");
  });

  it("uses the API with a key and throws at call time without one", () => {
    expect(selectPaystack(live)).toBe("live");
    expect(() =>
      selectPaystack({ appEnv: "production", nodeEnv: "production", secretKey: undefined }),
    ).toThrow(/PAYSTACK_SECRET_KEY/);
  });
});

describe("resolveAccountWith", () => {
  it("remembers a resolved name for a few minutes, so a lookup then a save call Paystack once", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { status: true, data: { account_number: ACCOUNT, account_name: "ADA OBI" } }),
    );
    const input = { accountNumber: ACCOUNT, bankCode: "058" };
    await resolveAccountWith(live, input);
    await resolveAccountWith(live, input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await resolveAccountWith(live, { ...input, bankCode: "044" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resetBankCacheForTests();
    await resolveAccountWith(live, input);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not remember a failed lookup", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { status: false }));
    fetchMock.mockResolvedValueOnce(
      json(200, { status: true, data: { account_number: ACCOUNT, account_name: "ADA OBI" } }),
    );
    const input = { accountNumber: ACCOUNT, bankCode: "058" };
    await expect(resolveAccountWith(live, input)).rejects.toThrow("PAYSTACK_UNAVAILABLE");
    await expect(resolveAccountWith(live, input)).resolves.toEqual({ accountName: "ADA OBI" });
  });

  it("sends the secret key as a Bearer token and returns the account name", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        status: true,
        message: "Account number resolved",
        data: { account_number: ACCOUNT, account_name: "ADA OBI", bank_id: 9 },
      }),
    );
    const result = await resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" });
    expect(result).toEqual({ accountName: "ADA OBI" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk_test_abc123");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.paystack.co/bank/resolve");
    expect(parsed.searchParams.get("account_number")).toBe(ACCOUNT);
    expect(parsed.searchParams.get("bank_code")).toBe("058");
  });

  it.each([400, 404, 422])("maps %s to BANK_ACCOUNT_NOT_FOUND", async (status) => {
    fetchMock.mockResolvedValue(
      json(status, { status: false, message: `Could not resolve account name ${ACCOUNT}` }),
    );
    const error = await caught(resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe("BANK_ACCOUNT_NOT_FOUND");
    expect(error.message).not.toContain(ACCOUNT);
    expect(loggedText()).not.toContain(ACCOUNT);
  });

  it("maps a 5xx to PAYSTACK_UNAVAILABLE without the account number", async () => {
    fetchMock.mockResolvedValue(json(503, { status: false, message: `down for ${ACCOUNT}` }));
    const error = await caught(resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" }));
    expect(error.message).toBe("PAYSTACK_UNAVAILABLE");
    expect(error.message).not.toContain(ACCOUNT);
    expect(JSON.stringify(error)).not.toContain(ACCOUNT);
    expect(loggedText()).not.toContain(ACCOUNT);
  });

  it("maps a 429 (too many requests) to a typed UnavailableError the screen can explain", async () => {
    fetchMock.mockResolvedValue(json(429, { status: false, message: "Too many requests" }));
    const error = await caught(resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" }));
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as UnavailableError).code).toBe("PAYSTACK_UNAVAILABLE");
    expect(loggedText()).not.toContain(ACCOUNT);
  });

  it("maps a network failure to PAYSTACK_UNAVAILABLE without leaking the URL", async () => {
    fetchMock.mockRejectedValue(
      new TypeError(`fetch failed: https://api.paystack.co/bank/resolve?account_number=${ACCOUNT}`),
    );
    const error = await caught(resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" }));
    expect(error.message).toBe("PAYSTACK_UNAVAILABLE");
    expect(error.cause).toBeUndefined();
    expect(loggedText()).not.toContain(ACCOUNT);
  });

  it("maps a malformed success body to an error without the account number", async () => {
    fetchMock.mockResolvedValue(json(200, { status: true, data: { account_number: ACCOUNT } }));
    const error = await caught(resolveAccountWith(live, { accountNumber: ACCOUNT, bankCode: "058" }));
    expect(error.message).not.toContain(ACCOUNT);
    expect(loggedText()).not.toContain(ACCOUNT);
  });

  it.each([
    ["012345678", "058"],
    ["01234567890", "058"],
    ["01234567a9", "058"],
    [ACCOUNT, "58"],
    [ACCOUNT, "1234567"],
    [ACCOUNT, "05a"],
  ])("rejects account %s / bank %s before calling Paystack", async (accountNumber, bankCode) => {
    const error = await caught(resolveAccountWith(live, { accountNumber, bankCode }));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).not.toContain(accountNumber);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createRecipientWith", () => {
  it("posts a nuban NGN recipient and returns its code", async () => {
    fetchMock.mockResolvedValue(
      json(201, {
        status: true,
        message: "Transfer recipient created successfully",
        data: {
          recipient_code: "RCP_abc",
          name: "ADA OBI",
          details: { account_number: ACCOUNT, account_name: "ADA OBI", bank_code: "058", bank_name: "GTBank" },
        },
      }),
    );
    const result = await createRecipientWith(live, {
      accountNumber: ACCOUNT,
      bankCode: "058",
      name: "ADA OBI",
    });
    expect(result).toEqual({ recipientCode: "RCP_abc", accountName: "ADA OBI" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transferrecipient");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk_test_abc123");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "nuban",
      name: "ADA OBI",
      account_number: ACCOUNT,
      bank_code: "058",
      currency: "NGN",
    });
  });

  it("maps a 422 to BANK_ACCOUNT_NOT_FOUND", async () => {
    fetchMock.mockResolvedValue(json(422, { status: false, message: `bad ${ACCOUNT}` }));
    const error = await caught(
      createRecipientWith(live, { accountNumber: ACCOUNT, bankCode: "058", name: "ADA OBI" }),
    );
    expect((error as ValidationError).code).toBe("BANK_ACCOUNT_NOT_FOUND");
    expect(error.message).not.toContain(ACCOUNT);
  });
});

describe("listBanksWith", () => {
  const bank = (name: string, code: string, extra: object = {}) => ({
    name,
    code,
    slug: name.toLowerCase(),
    active: true,
    is_deleted: false,
    ...extra,
  });

  it("follows meta.next while present and drops inactive banks", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          status: true,
          message: "Banks retrieved",
          data: [bank("Access Bank", "044"), bank("Old Bank", "999", { active: false })],
          meta: { next: "cursor-2", previous: null, perPage: 100 },
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          status: true,
          message: "Banks retrieved",
          data: [bank("GTBank", "058"), bank("Gone Bank", "998", { is_deleted: true })],
          meta: { next: null },
        }),
      );
    const banks = await listBanksWith(live);
    expect(banks).toEqual([
      { name: "Access Bank", code: "044" },
      { name: "GTBank", code: "058" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(first.pathname).toBe("/bank");
    expect(first.searchParams.get("country")).toBe("nigeria");
    expect(first.searchParams.get("currency")).toBe("NGN");
    const second = new URL((fetchMock.mock.calls[1] as [string])[0]);
    expect(second.searchParams.get("next")).toBe("cursor-2");
  });

  it("stops when meta is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { status: true, message: "ok", data: [bank("GTBank", "058")] }),
    );
    expect(await listBanksWith(live)).toEqual([{ name: "GTBank", code: "058" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches the list for 24 hours", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { status: true, message: "ok", data: [bank("GTBank", "058")] }),
    );
    const t0 = Date.UTC(2031, 0, 1);
    await listBanksWith(live, t0);
    await listBanksWith(live, t0 + 24 * 3_600_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await listBanksWith(live, t0 + 24 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resetBankCacheForTests();
    await listBanksWith(live, t0 + 24 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("fake Paystack (tests run with the fake)", () => {
  it("resolves accounts from fakePaystack.accounts and records recipients", async () => {
    fakePaystack.accounts.set(`058:${ACCOUNT}`, "ADA OBI");
    expect(await resolveAccount({ accountNumber: ACCOUNT, bankCode: "058" })).toEqual({
      accountName: "ADA OBI",
    });
    const recipient = await createRecipient({ accountNumber: ACCOUNT, bankCode: "058", name: "ADA OBI" });
    expect(recipient.accountName).toBe("ADA OBI");
    expect(recipient.recipientCode).toMatch(/^RCP_/);
    expect(fakePaystack.recipients).toEqual([recipient.recipientCode]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws BANK_ACCOUNT_NOT_FOUND for an unknown account", async () => {
    const error = await caught(resolveAccount({ accountNumber: ACCOUNT, bankCode: "058" }));
    expect((error as ValidationError).code).toBe("BANK_ACCOUNT_NOT_FOUND");
    expect(error.message).not.toContain(ACCOUNT);
  });

  it("lists fake banks without calling fetch", async () => {
    const banks = await listBanks();
    expect(banks.length).toBeGreaterThan(0);
    expect(banks.every((b) => /^\d{3,6}$/.test(b.code))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
