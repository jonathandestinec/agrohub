import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";
import { sendAlertEmail } from "@/modules/notifications/alert-emails";
import { buyer, officersOf } from "@/modules/notifications/recipients";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

const QTY = { crop: "Maize", quantity: 50, unit: "Bag" };

describe("sendAlertEmail (real database, no request scope: sends inline)", () => {
  it("emails each recipient once and not the actor", async () => {
    const a = await createTestUser({ email: "buyer-a@example.com" });
    const b = await createTestUser({ email: "buyer-b@example.com" });
    await sendAlertEmail({
      kind: "PAYMENT_CONFIRMED",
      subject: { type: "ORDER", id: "ord_1" },
      data: QTY,
      to: [buyer(a.id), buyer(b.id)],
      exclude: a.id,
    });
    expect(fakeOutbox.sent.map((m) => m.to)).toEqual(["buyer-b@example.com"]);
    expect(fakeOutbox.sent[0].html).toContain("/buyer/orders/ord_1");
    expect(fakeOutbox.sent[0].html).toContain("held until delivery is confirmed");
  });

  it("emails the officers of a cooperative", async () => {
    const coop = await createTestCooperative();
    const o1 = await createTestUser({ email: "officer-1@example.com" });
    const o2 = await createTestUser({ email: "officer-2@example.com" });
    for (const u of [o1, o2]) {
      await prisma.membership.create({
        data: { userId: u.id, cooperativeId: coop.id, role: "OFFICER", status: "ACTIVE" },
      });
    }
    await sendAlertEmail({
      kind: "ORDER_PAID",
      subject: { type: "ORDER", id: "ord_2" },
      data: QTY,
      to: await officersOf(prisma, coop.id),
    });
    expect(fakeOutbox.sent.map((m) => m.to).sort()).toEqual(["officer-1@example.com", "officer-2@example.com"]);
    expect(fakeOutbox.sent[0].html).toContain("/officer/orders/ord_2");
  });

  it("never throws when the transport throws, and logs no address or html", async () => {
    const a = await createTestUser({ email: "buyer-a@example.com" });
    const email = await import("@/lib/email");
    const spy = vi.spyOn(email, "sendEmail").mockRejectedValue(new Error("Resend failed to send email (rate_limit_exceeded)"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendAlertEmail({ kind: "PAYMENT_CONFIRMED", subject: { type: "ORDER", id: "o" }, data: QTY, to: [buyer(a.id)] }),
    ).resolves.toBeUndefined();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("alert email failed");
    expect(logged).not.toContain("buyer-a@example.com");
    expect(logged).not.toContain("<p>");
    spy.mockRestore();
    log.mockRestore();
  });
});
