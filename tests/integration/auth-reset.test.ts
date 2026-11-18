import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";

const password = "correct-horse-battery-staple";

async function clean() {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
}

async function verifiedUser(email: string) {
  await auth.api.signUpEmail({
    body: { name: "Amina Bello", email, password, phone: "+2348012345678", consent: true } as never,
  });
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  fakeOutbox.clear();
}

const request = (email: string) =>
  auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });

const settle = () => new Promise((r) => setTimeout(r, 250));

beforeEach(async () => {
  await clean();
  fakeOutbox.clear();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("password reset request", () => {
  it("emails a reset link to a known address", async () => {
    await verifiedUser("amina@example.com");
    await request("amina@example.com");
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(1));
    const mail = fakeOutbox.sent[0];
    expect(mail.to).toBe("amina@example.com");
    expect(mail.subject).toBe("Reset your AgroHub password");
    expect(mail.html).toContain("reset-password/");
  });

  it("answers an unknown address exactly like a known one and sends nothing", async () => {
    await verifiedUser("amina@example.com");
    const known = await request("amina@example.com");
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(1));
    fakeOutbox.clear();
    const unknown = await request("nobody@example.com");
    await settle();
    expect(unknown).toEqual(known);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("sends at most three reset emails per address per hour, with an identical response", async () => {
    await verifiedUser("amina@example.com");
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(await request("amina@example.com"));
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(3));
    await settle();
    expect(fakeOutbox.sent).toHaveLength(3);
    expect(responses[3]).toEqual(responses[0]);
  });

  it("starts sending again once earlier requests are over an hour old", async () => {
    await verifiedUser("amina@example.com");
    for (let i = 0; i < 4; i++) await request("amina@example.com");
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(3));
    await prisma.verification.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 3600_000) } });
    fakeOutbox.clear();
    await request("amina@example.com");
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(1));
  });

  it("still answers when the transport throws, and logs no address", async () => {
    await verifiedUser("amina@example.com");
    const email = await import("@/lib/email");
    const spy = vi.spyOn(email, "sendEmail").mockRejectedValue(new Error("Resend failed to send email (rate_limit_exceeded)"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request("amina@example.com");
    await settle();
    expect(res).toMatchObject({ status: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain("amina@example.com");
    spy.mockRestore();
    log.mockRestore();
  });

  it("revokes other sessions when the password is reset", async () => {
    await verifiedUser("amina@example.com");
    await auth.api.signInEmail({ body: { email: "amina@example.com", password } });
    expect(await prisma.session.count()).toBe(1);
    await request("amina@example.com");
    await vi.waitFor(() => expect(fakeOutbox.sent).toHaveLength(1));
    const token = /reset-password\/([^?"]+)/.exec(fakeOutbox.sent[0].html)![1];
    await auth.api.resetPassword({ body: { newPassword: "a-brand-new-passphrase", token } });
    expect(await prisma.session.count()).toBe(0);
    await expect(
      auth.api.signInEmail({ body: { email: "amina@example.com", password } }),
    ).rejects.toThrow();
  });
});
