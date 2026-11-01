import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
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
