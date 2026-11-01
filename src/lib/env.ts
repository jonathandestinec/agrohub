import { z } from "zod";

const emptyToUndefined = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
    STORAGE_ENDPOINT: emptyToUndefined,
    STORAGE_BUCKET: emptyToUndefined,
    STORAGE_ACCESS_KEY_ID: emptyToUndefined,
    STORAGE_SECRET_ACCESS_KEY: emptyToUndefined,
    STORAGE_REGION: z
      .string()
      .optional()
      .transform((value) => (value ? value : "auto")),
    RESEND_API_KEY: z
      .string()
      .optional()
      .transform((value) => (value ? value : undefined)),
    // Optional: local and tests use the fake. Calls fail at call time without it.
    PAYSTACK_SECRET_KEY: emptyToUndefined,
  })
  // Messages name the variable, never its value.
  .superRefine((value, ctx) => {
    const key = value.PAYSTACK_SECRET_KEY;
    if (key === undefined) return;
    if (value.APP_ENV === "staging" && !key.startsWith("sk_test_")) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYSTACK_SECRET_KEY"],
        message: "staging must use a Paystack test key (sk_test_)",
      });
    }
    if (value.APP_ENV === "production" && key.startsWith("sk_test_")) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYSTACK_SECRET_KEY"],
        message: "production must not use a Paystack test key",
      });
    }
  });

export type Env = z.infer<typeof schema>;

// Vercel previews get a new URL per deployment, so a fixed BETTER_AUTH_URL cannot
// match them. When it is unset, use the URL Vercel provides (branch URL first).
function withVercelAuthUrl(raw: Record<string, string | undefined>) {
  if (raw.BETTER_AUTH_URL) return raw;
  const vercelHost = raw.VERCEL_BRANCH_URL || raw.VERCEL_URL;
  return vercelHost ? { ...raw, BETTER_AUTH_URL: `https://${vercelHost}` } : raw;
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  // The local default selects the fake email, storage and Paystack adapters, so a production
  // build that omits APP_ENV must fail closed, not quietly run on fakes. Dev and test keep it.
  if (raw.NODE_ENV === "production" && !raw.APP_ENV) {
    throw new Error(
      "Invalid environment variables: APP_ENV: must be set (local, staging or production) when NODE_ENV is production",
    );
  }
  const result = schema.safeParse(withVercelAuthUrl(raw));
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${problems}`);
  }
  return result.data;
}

// Validated at startup: importing this module fails fast on bad configuration.
export const env: Env = parseEnv(process.env);
