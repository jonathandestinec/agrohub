import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UnavailableError } from "@/lib/errors";
import { verifyWebhookSignature, webhookSecret } from "@/lib/paystack";
import { confirmPayment } from "./payments";
import { settleRefund } from "./refunds";
import { settleTransferEvent } from "./sending";
import { webhookBody, type WebhookBody } from "./webhook-schema";

// Paystack's webhook bodies are small; anything larger is refused before parsing.
const MAX_BODY = 100_000;
// A row still PROCESSING after this long was left by a function that was killed mid-way.
const STALE_CLAIM_MS = 5 * 60_000;

export type WebhookResult = { status: 200 | 400 | 401 | 500; outcome?: string };

// Kept on each event row: ids, amounts and statuses only. Never the customer, card or bank data.
function trimmed(body: WebhookBody): Prisma.InputJsonObject {
  return {
    event: body.event,
    reference: body.data.reference ?? body.data.transaction_reference ?? null,
    status: body.data.status ?? null,
    amount: body.data.amount ?? null,
    currency: body.data.currency ?? null,
  };
}

async function dispatch(body: WebhookBody): Promise<string> {
  switch (body.event) {
    case "charge.success":
      return body.data.reference ? confirmPayment(body.data.reference) : "NO_REFERENCE";
    case "refund.processed":
    case "refund.failed":
      return settleRefund(
        {
          refundId: body.data.id === undefined ? undefined : String(body.data.id),
          transactionReference: body.data.transaction_reference,
          amountKobo: body.data.amount,
        },
        body.event === "refund.processed" ? "PROCESSED" : "FAILED",
      );
    case "transfer.success":
    case "transfer.failed":
    case "transfer.reversed":
      return body.data.reference ? settleTransferEvent(body.data.reference) : "NO_REFERENCE";
    default:
      // Every other event is recorded and ignored.
      return "IGNORED";
  }
}

// Records the event once by its key. A key already processed (or being processed) is a duplicate
// delivery and does nothing; a key left for retry (Paystack was unreachable), or left PROCESSING
// for over five minutes by a killed function, is claimed again.
async function claim(key: string, body: WebhookBody): Promise<boolean> {
  const now = new Date();
  try {
    await prisma.paystackEvent.create({
      data: {
        eventKey: key,
        event: body.event,
        reference: body.data.reference ?? body.data.transaction_reference ?? null,
        payload: trimmed(body),
        outcome: "PROCESSING",
        claimedAt: now,
      },
    });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const { count } = await prisma.paystackEvent.updateMany({
      where: {
        eventKey: key,
        OR: [{ outcome: "RETRY" }, { outcome: "PROCESSING", claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      },
      data: { outcome: "PROCESSING", claimedAt: now },
    });
    return count === 1;
  }
}

/**
 * System function, no Actor: Paystack calls it, authenticated by the HMAC signature of the raw
 * body. The work is done before answering (work after a response is not reliable on Vercel).
 * If Paystack cannot be reached to verify, the event is left for retry and the answer is 500,
 * so Paystack delivers it again.
 */
export async function handlePaystackWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  if (rawBody.length > MAX_BODY) return { status: 400 };
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret())) return { status: 401 };
  let parsed: WebhookBody;
  try {
    const result = webhookBody.safeParse(JSON.parse(rawBody));
    if (!result.success) return { status: 400 };
    parsed = result.data;
  } catch {
    return { status: 400 };
  }
  // Paystack refund events may carry no id: key them by the transaction and amount.
  const id =
    parsed.data.id ??
    parsed.data.reference ??
    (parsed.data.transaction_reference ? `${parsed.data.transaction_reference}:${parsed.data.amount ?? ""}` : undefined);
  if (id === undefined || id === null) return { status: 400 };
  const key = `${parsed.event}:${id}`;
  if (!(await claim(key, parsed))) return { status: 200, outcome: "DUPLICATE" };
  try {
    const outcome = await dispatch(parsed);
    await prisma.paystackEvent.update({ where: { eventKey: key }, data: { outcome } });
    return { status: 200, outcome };
  } catch (error) {
    await prisma.paystackEvent.update({ where: { eventKey: key }, data: { outcome: "RETRY" } });
    console.error("paystack webhook failed", {
      event: parsed.event,
      error: error instanceof UnavailableError ? error.code : error instanceof Error ? error.name : "unknown",
    });
    return { status: 500, outcome: "RETRY" };
  }
}
