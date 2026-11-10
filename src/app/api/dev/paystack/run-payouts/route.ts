import { runFakePayouts } from "@/modules/payments/service";

// Dev-only: runs one order's payouts as the next day's payouts job would, for local e2e tests.
// 404 unless the fake Paystack is in use (runFakePayouts returns null everywhere else).
export async function POST(request: Request): Promise<Response> {
  const orderId = new URL(request.url).searchParams.get("orderId") ?? "";
  if (!/^[a-z0-9]{1,64}$/.test(orderId)) return new Response("Not found", { status: 404 });
  const result = await runFakePayouts(orderId);
  if (!result) return new Response("Not found", { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
