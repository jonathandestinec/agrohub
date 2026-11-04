import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, UnavailableError } from "@/lib/errors";
import {
  FAKE_WEBHOOK_SECRET,
  fakePaystack,
  fakeSettle,
  fakeWebhook,
  initializeTransaction,
  initializeTransactionWith,
  listTransactionsWith,
  refundTransaction,
  refundTransactionWith,
  verifyTransaction,
  verifyTransactionWith,
  verifyWebhookSignature,
  webhookSecret,
  type PaystackConfig,
} from "@/lib/paystack";

const live: PaystackConfig = { appEnv: "staging", nodeEnv: "production", secretKey: "sk_test_abc123" };
const EMAIL = "buyer@example.com";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
const logSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    logSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
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

describe("initializeTransactionWith", () => {
  it("posts the amount in kobo, NGN, three channels and our reference", async () => {
    fetchMock.mockResolvedValue(
      json(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "pay_1" } }),
    );
    const result = await initializeTransactionWith(live, {
      email: EMAIL,
      amountKobo: 197_500_000,
      reference: "pay_1",
      callbackUrl: "https://staging.example/buyer/orders/o1",
      metadata: { orderId: "o1" },
    });
    expect(result).toEqual({ authorizationUrl: "https://checkout.paystack.com/abc", accessCode: "abc" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      email: EMAIL,
      amount: 197_500_000,
      currency: "NGN",
      reference: "pay_1",
      callback_url: "https://staging.example/buyer/orders/o1",
      channels: ["card", "bank_transfer", "ussd"],
      metadata: { orderId: "o1" },
    });
  });

  it("maps a 500 to PAYSTACK_UNAVAILABLE and never logs the email or the key", async () => {
    fetchMock.mockResolvedValue(json(500, { status: false }));
    const error = await caught(
      initializeTransactionWith(live, { email: EMAIL, amountKobo: 100, reference: "pay_1", callbackUrl: "https://x", metadata: { orderId: "o1" } }),
    );
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as UnavailableError).code).toBe("PAYSTACK_UNAVAILABLE");
    expect(loggedText()).not.toContain(EMAIL);
    expect(loggedText()).not.toContain("sk_test_abc123");
  });

  it("maps a 400 to PAYSTACK_REFUSED, keeping only allow-listed messages", async () => {
    fetchMock.mockResolvedValue(json(400, { status: false, message: "Duplicate Transaction Reference for buyer@example.com" }));
    const error = await caught(
      initializeTransactionWith(live, { email: EMAIL, amountKobo: 100, reference: "pay_1", callbackUrl: "https://x", metadata: { orderId: "o1" } }),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("PAYSTACK_REFUSED");
    expect(error.message).not.toContain(EMAIL);
  });
});

describe("verifyTransactionWith", () => {
  it("maps amount, fees, currency, id and channel", async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        status: true,
        data: { id: 4099260516, status: "success", reference: "pay_1", amount: 65_000_000, fees: 200_000, currency: "NGN", channel: "bank_transfer", paid_at: "2026-11-04T10:00:00.000Z", customer: { email: EMAIL } },
      }),
    );
    expect(await verifyTransactionWith(live, "pay_1")).toEqual({
      status: "success",
      amountKobo: 65_000_000,
      currency: "NGN",
      transactionId: "4099260516",
      feesKobo: 200_000,
      channel: "bank_transfer",
      paidAt: "2026-11-04T10:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.paystack.co/transaction/verify/pay_1");
  });

  it("refuses a reference that is not a plain token", async () => {
    await expect(verifyTransactionWith(live, "../bank")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refundTransactionWith", () => {
  it("posts the transaction reference and the amount in kobo", async () => {
    fetchMock.mockResolvedValue(json(200, { status: true, data: { id: 3018284, status: "pending" } }));
    expect(await refundTransactionWith(live, { reference: "pay_1", amountKobo: 32_500_000 })).toEqual({ refundId: "3018284", status: "pending" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/refund");
    expect(JSON.parse(String(init.body))).toEqual({ transaction: "pay_1", amount: 32_500_000 });
  });
});

describe("listTransactionsWith", () => {
  it("reads successful transactions page by page", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { status: true, data: [{ id: 1, reference: "pay_1", amount: 100, status: "success" }], meta: { page: 1, pageCount: 2 } }))
      .mockResolvedValueOnce(json(200, { status: true, data: [{ id: 2, reference: "pay_2", amount: 200, status: "success" }], meta: { page: 2, pageCount: 2 } }));
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-04T00:00:00Z");
    expect(await listTransactionsWith(live, { from, to })).toEqual([
      { reference: "pay_1", amountKobo: 100, transactionId: "1" },
      { reference: "pay_2", amountKobo: 200, transactionId: "2" },
    ]);
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.pathname).toBe("/transaction");
    expect(first.searchParams.get("status")).toBe("success");
    expect(first.searchParams.get("from")).toBe(from.toISOString());
    expect(first.searchParams.get("perPage")).toBe("100");
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { id: 1, reference: "pay_1" } });
  const secret = "sk_test_abc123";
  const good = createHmac("sha512", secret).update(body).digest("hex");

  it("accepts the HMAC-SHA512 of the raw body", () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
  });

  it("refuses a changed body, a missing signature and a short one", () => {
    expect(verifyWebhookSignature(`${body.slice(0, -1)}!`, good, secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, good.slice(0, 64), secret)).toBe(false);
    expect(verifyWebhookSignature(body, good, "sk_test_other")).toBe(false);
  });
});

describe("fake Paystack (tests run with the fake)", () => {
  it("initializes, settles and verifies a transaction, with a signed webhook", async () => {
    const { authorizationUrl } = await initializeTransaction({
      email: EMAIL,
      amountKobo: 65_000_000,
      reference: "pay_f1",
      callbackUrl: "http://localhost/buyer/orders/o1",
      metadata: { orderId: "o1" },
    });
    expect(authorizationUrl).toBe("/dev/paystack/checkout?reference=pay_f1");
    expect((await verifyTransaction("pay_f1")).status).toBe("pending");
    const { rawBody, signature } = fakeSettle("pay_f1", "success");
    const verified = await verifyTransaction("pay_f1");
    expect(verified).toMatchObject({ status: "success", amountKobo: 65_000_000, currency: "NGN", feesKobo: 200_000 });
    expect(webhookSecret()).toBe(FAKE_WEBHOOK_SECRET);
    expect(verifyWebhookSignature(rawBody, signature, webhookSecret())).toBe(true);
    expect(JSON.parse(rawBody)).toMatchObject({ event: "charge.success", data: { reference: "pay_f1", amount: 65_000_000, currency: "NGN" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("charges the fake fee like Paystack Nigeria: 1.5% plus ₦100, capped at ₦2,000", async () => {
    for (const [amount, fee] of [[65_000_000, 200_000], [500_000, 17_500], [200_000, 3_000]]) {
      await initializeTransaction({ email: EMAIL, amountKobo: amount, reference: `pay_${amount}`, callbackUrl: "http://x", metadata: { orderId: "o" } });
      fakeSettle(`pay_${amount}`, "success");
      expect((await verifyTransaction(`pay_${amount}`)).feesKobo).toBe(fee);
    }
  });

  it("records refunds, and can be made unavailable or to refuse the next refund", async () => {
    await initializeTransaction({ email: EMAIL, amountKobo: 100_000, reference: "pay_r", callbackUrl: "http://x", metadata: { orderId: "o" } });
    fakeSettle("pay_r", "success");
    const refund = await refundTransaction({ reference: "pay_r", amountKobo: 100_000 });
    expect(fakePaystack.refunds).toEqual([{ reference: "pay_r", amountKobo: 100_000, refundId: refund.refundId }]);
    fakePaystack.failNextRefund = true;
    await expect(refundTransaction({ reference: "pay_r", amountKobo: 1 })).rejects.toBeInstanceOf(UnavailableError);
    fakePaystack.down = true;
    await expect(
      initializeTransaction({ email: EMAIL, amountKobo: 1, reference: "pay_d", callbackUrl: "http://x", metadata: { orderId: "o" } }),
    ).rejects.toBeInstanceOf(UnavailableError);
  });

  it("signs any body for tests that forge a notification", () => {
    const { rawBody, signature } = fakeWebhook({ event: "charge.success", data: { id: 9, reference: "pay_x" } });
    expect(verifyWebhookSignature(rawBody, signature, FAKE_WEBHOOK_SECRET)).toBe(true);
  });
});
