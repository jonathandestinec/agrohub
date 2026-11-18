import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { z } from "zod";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env, trustedOrigins } from "@/lib/env";
import { withVerifiedCallback } from "@/lib/verified-callback";
import { passwordResetEmail, verificationEmail } from "@/modules/notifications/emails";

// At most this many reset emails per account per hour. Counted from the verification rows Better
// Auth writes for each request, so the limit holds across serverless instances without a table.
const RESET_EMAILS_PER_HOUR = 3;

// WARNING: never run the Better Auth CLI with the repo root as cwd (it loads .env); use `npm run auth:generate`.
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
  telemetry: { enabled: false },
  // update-user would let a user rename themselves (the bank name check compares against
  // User.name) or change the admin-only phone record. Name and phone are set at sign-up only.
  disabledPaths: ["/update-user"],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      try {
        const recent = await prisma.verification.count({
          where: {
            identifier: { startsWith: "reset-password:" },
            value: user.id,
            createdAt: { gte: new Date(Date.now() - 3600_000) },
          },
        });
        if (recent > RESET_EMAILS_PER_HOUR) {
          console.warn("password reset throttled");
          return;
        }
        await sendEmail({ to: user.email, ...passwordResetEmail({ name: user.name, link: url }) });
      } catch (error) {
        console.error("password reset email failed", {
          error: error instanceof Error ? { name: error.name, message: error.message } : "non-Error thrown",
        });
      }
    },
  },
  advanced: {
    // Better Auth awaits sendResetPassword inline by default; hand it to after() instead so the
    // response never waits on Resend. Outside a request scope the promise just runs on its own.
    backgroundTasks: {
      handler: (promise) => {
        try {
          after(() => promise);
        } catch {
          void promise;
        }
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, ...verificationEmail({ link: withVerifiedCallback(url) }) });
    },
  },
  // nextCookies must stay last: it copies Set-Cookie from auth.api calls in server actions.
  plugins: [twoFactor({ issuer: "AgroHub" }), nextCookies()],
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
