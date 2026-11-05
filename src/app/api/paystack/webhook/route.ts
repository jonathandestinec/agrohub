import { handlePaystackWebhook } from "@/modules/payments/service";

// Paystack's webhook. The raw body is read as text, since the signature is over the exact bytes
// Paystack sent. Nothing about the body is logged here.
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const { status } = await handlePaystackWebhook(rawBody, request.headers.get("x-paystack-signature"));
  return Response.json({}, { status, headers: { "Cache-Control": "no-store" } });
}
