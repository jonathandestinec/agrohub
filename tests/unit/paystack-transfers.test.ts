import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnavailableError } from "@/lib/errors";
import {
  fakePaystack,
  initiateTransfer,
  initiateTransferWith,
  verifyTransfer,
  verifyTransferWith,
  type PaystackConfig,
} from "@/lib/paystack";
import { paystackTransferGateway } from "@/modules/payments/payout-gateway";

const live: PaystackConfig = { appEnv: "staging", nodeEnv: "production", secretKey: "sk_test_abc123" };

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

const INPUT = { amountKobo: 179_400_000, recipientCode: "RCP_abc", reference: "po_o1_f_u1_1-1", reason: "AgroHub order O1" };

describe("initiateTransferWith", () => {
  it("posts source balance, the amount in kobo, the recipient and our reference", async () => {
    fetchMock.mockResolvedValue(json(200, { status: true, data: { transfer_code: "TRF_1", status: "pending", reference: INPUT.reference } }));
    expect(await initiateTransferWith(live, INPUT)).toEqual({ transferCode: "TRF_1", status: "pending" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transfer");
    expect(JSON.parse(String(init.body))).toEqual({
      source: "balance",
      amount: 179_400_000,
      recipient: "RCP_abc",
      reference: INPUT.reference,
      reason: INPUT.reason,
    });
  });

  it("maps a 500 to PAYSTACK_UNAVAILABLE and never logs the recipient", async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    await expect(initiateTransferWith(live, INPUT)).rejects.toBeInstanceOf(UnavailableError);
    expect(JSON.stringify(logSpies.flatMap((s) => s.mock.calls))).not.toContain("RCP_abc");
  });
});

describe("verifyTransferWith", () => {
  it("reads the status and transfer code", async () => {
    fetchMock.mockResolvedValue(json(200, { status: true, data: { status: "success", transfer_code: "TRF_1" } }));
    expect(await verifyTransferWith(live, "po_o1_f_u1_1-1")).toEqual({ status: "success", transferCode: "TRF_1" });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://api.paystack.co/transfer/verify/po_o1_f_u1_1-1");
  });

  it("reads an unknown reference as not_found", async () => {
    fetchMock.mockResolvedValue(json(404, { status: false, message: "Transfer not found" }));
    expect(await verifyTransferWith(live, "po_x-1")).toEqual({ status: "not_found", transferCode: null });
  });
});

describe("paystackTransferGateway (live client)", () => {
  // The gateway uses the configured client; in tests that is the fake, so stub its modes.
  it("maps otp and pending to PENDING", async () => {
    fakePaystack.transferMode = "otp";
    expect((await paystackTransferGateway.send(INPUT)).outcome).toBe("PENDING");
    fakePaystack.transferMode = "pending";
    expect((await paystackTransferGateway.send({ ...INPUT, reference: "po_o1_f_u1_1-2" })).outcome).toBe("PENDING");
  });

  it("maps insufficient balance to NO_FUNDS", async () => {
    fakePaystack.transferMode = "insufficient";
    expect(await paystackTransferGateway.send(INPUT)).toEqual({ outcome: "NO_FUNDS", transferCode: null, failureReason: "NO_FUNDS" });
    expect(fakePaystack.transfers.size).toBe(0);
  });

  it("maps success to PAID and failed to FAILED", async () => {
    expect((await paystackTransferGateway.send(INPUT)).outcome).toBe("PAID");
    fakePaystack.transferMode = "fail";
    expect((await paystackTransferGateway.send({ ...INPUT, reference: "po_o1_f_u1_1-2" })).outcome).toBe("FAILED");
  });

  it("maps Paystack being down to PENDING: the transfer may exist, so it is checked, never resent", async () => {
    fakePaystack.down = true;
    expect((await paystackTransferGateway.send(INPUT)).outcome).toBe("PENDING");
  });

  it("checks a transfer by reference", async () => {
    fakePaystack.transferMode = "pending";
    await initiateTransfer(INPUT);
    expect(await paystackTransferGateway.check(INPUT.reference)).toBe("PENDING");
    fakePaystack.transfers.get(INPUT.reference)!.status = "reversed";
    expect(await paystackTransferGateway.check(INPUT.reference)).toBe("REVERSED");
    expect(await paystackTransferGateway.check("po_unknown-1")).toBe("FAILED");
    expect((await verifyTransfer(INPUT.reference)).status).toBe("reversed");
  });
});
