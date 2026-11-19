import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn<(m: { to: string; subject: string; html: string }) => Promise<void>>(async () => {}),
  findMany: vi.fn(),
  scheduled: [] as Array<() => Promise<void>>,
}));

vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findMany: mocks.findMany } } }));

afterEach(() => {
  vi.doUnmock("next/server");
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.findMany.mockReset();
  mocks.scheduled.length = 0;
  vi.restoreAllMocks();
});

const QTY = { crop: "Maize", quantity: 50, unit: "Bag" };
const SAMPLES: Record<string, object> = {
  PAYMENT_CONFIRMED: QTY,
  ORDER_PAID: QTY,
  LOT_ORDER_PAID: QTY,
  DELIVERY_DATE_SET: { ...QTY, date: "2026-12-01" },
  ORDER_DELIVERED: QTY,
  ORDER_RECEIPT_CONFIRMED: QTY,
  PAYOUT_SENT: { crop: "Maize", amountKobo: "1250000" },
  REFUND_SENT: { crop: "Maize", amountKobo: "1250000" },
  ORDER_PROBLEM_REPORTED: QTY,
  DISPUTE_RESOLVED: QTY,
  NAME_CHANGE_APPROVED: {},
  NAME_CHANGE_REJECTED: {},
  OFFER_ACCEPTED: QTY,
  OFFER_COUNTERED: QTY,
  LOT_APPROVED: { crop: "Maize" },
  LOT_REJECTED: { crop: "Maize" },
};

describe("buildAlertEmail", () => {
  it("covers exactly the approved kinds, and no chatty ones", async () => {
    const { EMAILED_KINDS } = await import("@/modules/notifications/alert-emails");
    expect([...EMAILED_KINDS].sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const never of ["MESSAGE_RECEIVED", "ORDER_PREPARING", "OFFER_RECEIVED", "OFFER_DECLINED", "LOT_COUNTERED", "ORDER_EXPIRED"]) {
      expect(EMAILED_KINDS.has(never as never)).toBe(false);
    }
  });

  it.each(Object.keys(SAMPLES))("%s builds a safe email with an absolute link", async (kind) => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    const mail = buildAlertEmail(kind as never, SAMPLES[kind] as never, "BUYER", "order_1");
    expect(mail).not.toBeNull();
    expect(mail!.subject.length).toBeGreaterThan(3);
    expect(mail!.html).toMatch(/href="https?:\/\/[^"]+\/(buyer|officer|farmer|account)[^"]*"/);
    const text = `${mail!.subject} ${mail!.html}`.toLowerCase();
    for (const banned of ["escrow", "floor", "phone", "bank account"]) expect(text).not.toContain(banned);
  });

  it("states the held payment in the agreed words", async () => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    const mail = buildAlertEmail("PAYMENT_CONFIRMED", QTY as never, "BUYER", "o1")!;
    expect(mail.html).toContain("held until delivery is confirmed");
  });

  it("formats money through money.ts and escapes values", async () => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    const mail = buildAlertEmail("PAYOUT_SENT", { crop: "<i>Yam</i>", amountKobo: "1250000" } as never, "FARMER", "o1")!;
    expect(mail.html).toContain("₦12,500");
    expect(mail.html).not.toContain("<i>");
  });

  it("reads naturally for many, for one and for odd unit names", async () => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    const html = (kind: string, quantity: number, unit: string) =>
      buildAlertEmail(kind as never, { crop: "Maize", quantity, unit } as never, "BUYER", "o1")!.html;
    expect(html("PAYMENT_CONFIRMED", 50, "Bag")).toContain("Your payment for 50 bags of maize arrived.");
    expect(html("PAYMENT_CONFIRMED", 1, "Bag")).toContain("Your payment for 1 bag of maize arrived.");
    expect(html("ORDER_PAID", 3, "100kg bag")).toContain("3 100kg bags of maize");
    expect(html("ORDER_PAID", 20, "kg")).toContain("20 kg of maize");
    expect(html("LOT_ORDER_PAID", 2, "Box")).toContain("2 boxes of your maize");
    expect(html("PAYMENT_CONFIRMED", 50, "Bag")).not.toContain("Bag of");
  });

  it("links by recipient role", async () => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    const officer = buildAlertEmail("PAYOUT_SENT", { crop: "Maize", amountKobo: "100" } as never, "OFFICER", "o1")!;
    const farmer = buildAlertEmail("PAYOUT_SENT", { crop: "Maize", amountKobo: "100" } as never, "FARMER", "o1")!;
    expect(officer.html).toContain("/officer/orders/o1");
    expect(farmer.html).toContain("/farmer/earnings/o1");
  });

  it("returns null for a kind that is not emailed or data that fails its shape", async () => {
    const { buildAlertEmail } = await import("@/modules/notifications/alert-emails");
    expect(buildAlertEmail("MESSAGE_RECEIVED", { thread: "t" } as never, "BUYER", "t")).toBeNull();
    expect(buildAlertEmail("LOT_APPROVED", { crop: "Maize", floorPrice: 5 } as never, "FARMER", "l")).toBeNull();
  });
});

describe("sendAlertEmail", () => {
  const input = {
    kind: "PAYMENT_CONFIRMED" as const,
    subject: { type: "ORDER" as const, id: "o1" },
    data: QTY,
    to: [
      { userId: "u1", role: "BUYER" as const, cooperativeId: null },
      { userId: "u2", role: "BUYER" as const, cooperativeId: null },
      { userId: "u3", role: "BUYER" as const, cooperativeId: null },
    ],
  };
  const users = [
    { id: "u1", email: "one@x.ng" },
    { id: "u2", email: "two@x.ng" },
    { id: "u3", email: "three@x.ng" },
  ];

  function trackConcurrency() {
    let inFlight = 0;
    let max = 0;
    mocks.sendEmail.mockImplementation(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    return () => max;
  }

  it("deferred path: schedules ONE task and sends sequentially, one in flight", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({ after: (fn: () => Promise<void>) => mocks.scheduled.push(fn) }));
    mocks.findMany.mockResolvedValue(users);
    const max = trackConcurrency();
    const { sendAlertEmail } = await import("@/modules/notifications/alert-emails");
    await sendAlertEmail(input);
    expect(mocks.scheduled).toHaveLength(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    await mocks.scheduled[0]();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    expect(max()).toBe(1);
  });

  it("inline path (no request scope): awaited, sequential, one in flight", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("`after` was called outside a request scope");
      },
    }));
    mocks.findMany.mockResolvedValue(users);
    const max = trackConcurrency();
    const { sendAlertEmail } = await import("@/modules/notifications/alert-emails");
    await sendAlertEmail(input);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    expect(max()).toBe(1);
  });

  it("drops the actor, sends nothing for a kind outside the list or an empty audience", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("outside a request scope");
      },
    }));
    mocks.findMany.mockResolvedValue([users[1], users[2]]);
    const { sendAlertEmail } = await import("@/modules/notifications/alert-emails");
    await sendAlertEmail({ ...input, exclude: "u1" });
    expect(mocks.findMany.mock.calls[0][0].where.id.in).toEqual(["u2", "u3"]);
    mocks.sendEmail.mockClear();
    await sendAlertEmail({ ...input, kind: "MESSAGE_RECEIVED" as never, data: {} as never });
    await sendAlertEmail({ ...input, to: [] });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("one failing send does not stop the rest, never throws, and logs no address or html", async () => {
    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: () => {
        throw new Error("outside a request scope");
      },
    }));
    mocks.findMany.mockResolvedValue(users);
    mocks.sendEmail
      .mockRejectedValueOnce(new Error("Resend failed to send email (rate_limit_exceeded)"))
      .mockResolvedValue(undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendAlertEmail } = await import("@/modules/notifications/alert-emails");
    await expect(sendAlertEmail(input)).resolves.toBeUndefined();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("PAYMENT_CONFIRMED");
    for (const secret of ["one@x.ng", "two@x.ng", "<p>", "held until"]) expect(logged).not.toContain(secret);
  });
});
