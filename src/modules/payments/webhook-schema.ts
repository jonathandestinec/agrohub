import { z } from "zod";

// The parts of a Paystack webhook body AgroHub reads. Everything else (customer, authorization,
// card and bank details) is ignored and never stored.
export const webhookBody = z.object({
  event: z.string().min(1).max(100),
  data: z
    .object({
      id: z.union([z.number(), z.string().min(1).max(100)]).optional(),
      reference: z.string().min(1).max(100).optional(),
      status: z.string().max(50).optional(),
      amount: z.number().int().nonnegative().optional(),
      currency: z.string().max(10).optional(),
    })
    .passthrough(),
});

export type WebhookBody = z.infer<typeof webhookBody>;
