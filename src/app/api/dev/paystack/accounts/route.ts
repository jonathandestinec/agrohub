import { z } from "zod";
import { env } from "@/lib/env";
import { fakePaystack, validateBankInput } from "@/lib/paystack";

const body = z.object({
  bankCode: z.string(),
  accountNumber: z.string(),
  accountName: z.string().trim().min(1).max(200),
});

// Dev-only: lets local e2e tests register an account in this server's fake Paystack, so
// the bank name check has something to resolve. 404 everywhere else, with the same two
// independent guards as /api/dev/outbox. The account number is never echoed or logged.
export async function POST(request: Request): Promise<Response> {
  if (env.APP_ENV !== "local" || process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await request.json());
    validateBankInput(input);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  fakePaystack.accounts.set(`${input.bankCode}:${input.accountNumber}`, input.accountName);
  return new Response(null, { status: 201, headers: { "Cache-Control": "no-store" } });
}
