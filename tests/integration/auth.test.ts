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
});
