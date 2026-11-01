import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      const href = escapeHtml(url);
      await sendEmail({
        to: user.email,
        subject: "Verify your AgroHub email address",
        html: `<p>Welcome to AgroHub.</p><p><a href="${href}">Verify your email address</a> to finish signing up.</p><p>If you did not sign up, you can ignore this email.</p>`,
      });
    },
  },
  user: {
    additionalFields: {
      // Private contact detail: kept out of every Better Auth response and session payload.
      phone: {
        type: "string",
        required: true,
        input: true,
        returned: false,
        validator: { input: z.string().trim().min(1, "Phone number is required") },
      },
      // Stamped with the server's clock by the user-create hook below; never client-supplied.
      // The default only satisfies Better Auth's required-field check before the hook runs.
      consentAcceptedAt: {
        type: "date",
        required: true,
        input: false,
        defaultValue: () => new Date(),
      },
      locale: {
        type: "string",
        required: true,
        input: false,
        defaultValue: "en",
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Every user creation must carry `consent: true` in the request body.
        // Status 400, not 403: sign-up turns a 403 from this hook into a fake success.
        before: async (user, ctx) => {
          if (ctx?.body?.consent !== true) {
            throw new APIError("BAD_REQUEST", {
              code: "CONSENT_REQUIRED",
              message: "Consent to the privacy notice is required to sign up",
            });
          }
          return { data: { ...user, consentAcceptedAt: new Date() } };
        },
      },
    },
  },
});

// Better Auth's generated body type has no `consent`; the user-create hook above reads it.
export type SignUpEmailBody = NonNullable<
  Parameters<typeof auth.api.signUpEmail>[0]
>["body"] & {
  consent?: boolean;
};
