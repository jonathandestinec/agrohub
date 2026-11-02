import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APIError } from "better-auth/api";
import { auth, type SignUpEmailBody } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fakeOutbox } from "@/lib/email";

const password = "correct-horse-battery-staple";

function signUp(body: SignUpEmailBody) {
  return auth.api.signUpEmail({ body });
}

async function cleanAuthTables() {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
}

async function rejectionOf(promise: Promise<unknown>): Promise<APIError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof APIError) return error;
    throw error;
  }
  throw new Error("Expected the call to be refused, but it succeeded");
}

beforeEach(async () => {
  await cleanAuthTables();
  fakeOutbox.clear();
});

afterAll(async () => {
  await cleanAuthTables();
  await prisma.$disconnect();
});

describe("email and password sign-up", () => {
  it("creates the user and sends exactly one verification email", async () => {
    const before = Date.now();

    const result = await signUp({
      name: "Amina Bello",
      email: "amina@example.com",
      password,
      phone: "+2348012345678",
      consent: true,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "amina@example.com" },
    });
    expect(user.phone).toBe("+2348012345678");
    expect(user.locale).toBe("en");
    expect(user.emailVerified).toBe(false);
    // Stamped by the server at sign-up.
    expect(user.consentAcceptedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.consentAcceptedAt.getTime()).toBeLessThanOrEqual(Date.now());

    // Phone is private: stored, but never in an auth response.
    expect(result.user).not.toHaveProperty("phone");

    expect(fakeOutbox.sent).toHaveLength(1);
    expect(fakeOutbox.sent[0].to).toBe("amina@example.com");
  });

  it("refuses sign-in before the email is verified", async () => {
    await signUp({
      name: "Chidi Okafor",
      email: "chidi@example.com",
      password,
      phone: "+2348098765432",
      consent: true,
    });

    const error = await rejectionOf(
      auth.api.signInEmail({
        body: { email: "chidi@example.com", password },
      }),
    );

    expect(error.statusCode).toBe(403);
    expect(error.body?.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("refuses sign-up without consent and creates no user", async () => {
    const error = await rejectionOf(
      signUp({
        name: "Tunde Adeyemi",
        email: "tunde@example.com",
        password,
        phone: "+2348011122233",
      }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.body?.code).toBe("CONSENT_REQUIRED");
    expect(await prisma.user.count()).toBe(0);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("sends a verification link that returns to /verified, whatever the client asked", async () => {
    await signUp({
      name: "Ngozi Eze",
      email: "ngozi@example.com",
      password,
      phone: "+2348033344455",
      consent: true,
      callbackURL: "https://evil.example/phish",
    });

    const href = fakeOutbox.sent[0].html.match(/href="([^"]+)"/)?.[1];
    const link = new URL((href ?? "").replace(/&amp;/g, "&"));
    expect(link.pathname).toBe("/api/auth/verify-email");
    expect(link.searchParams.get("callbackURL")).toBe("/verified");
    expect(link.searchParams.get("token")).toBeTruthy();
  });

  it("keeps a safe next on the /verified callback", async () => {
    await signUp({
      name: "Ife Ade",
      email: "ife@example.com",
      password,
      phone: "+2348033344466",
      consent: true,
      callbackURL: "/verified?next=%2Fjoin%2Ftok-1",
    });

    const href = fakeOutbox.sent[0].html.match(/href="([^"]+)"/)?.[1];
    const link = new URL((href ?? "").replace(/&amp;/g, "&"));
    expect(link.searchParams.get("callbackURL")).toBe("/verified?next=%2Fjoin%2Ftok-1");
  });
});

describe("POST /api/auth/update-user", () => {
  async function signedInCookie(email: string): Promise<string> {
    await signUp({ name: "Bola Ade", email, password, phone: "+2348011122233", consent: true });
    await prisma.user.update({ where: { email }, data: { emailVerified: true } });
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.join("; ");
  }

  it("is refused for a signed-in user, and the name and phone stay unchanged", async () => {
    const email = "bola@example.com";
    const cookie = await signedInCookie(email);

    // Sanity check: the cookie is a working session.
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } }),
    );
    expect(session.status).toBe(200);
    expect(((await session.json()) as { user?: { email?: string } } | null)?.user?.email).toBe(
      email,
    );

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Someone Else", phone: "+2349099999999" }),
      }),
    );
    expect(response.status).toBe(404);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe("Bola Ade");
    expect(user.phone).toBe("+2348011122233");
  });
});
