"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { settleFakeCheckout } from "@/modules/payments/service";

const reference = z.string().min(1).max(100);

// Local development only: settleFakeCheckout does nothing unless the fake Paystack is in use.
export async function settleFakeCheckoutAction(formData: FormData): Promise<void> {
  const ref = reference.parse(formData.get("reference"));
  const outcome = formData.get("outcome") === "failed" ? "failed" : "success";
  const settled = await settleFakeCheckout(ref, outcome);
  if (!settled) redirect("/");
  redirect(`/buyer/orders/${settled.orderId}`);
}
