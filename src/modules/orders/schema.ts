import { z } from "zod";

const id = z.string().min(1).max(100);

export const startCheckoutInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("LOT"), lotId: id, quantity: z.number().int().min(1).max(1_000_000), deliveryQuoteId: id.optional() }),
  z.object({ source: z.literal("OFFER"), offerId: id, deliveryQuoteId: id.optional() }),
]);

export type StartCheckoutInput = z.infer<typeof startCheckoutInput>;
