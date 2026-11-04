import { z } from "zod";

const kobo = z.number().int().min(1).max(2_000_000_000);

export const makeOfferInput = z.object({
  lotId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(1_000_000),
  offeredKobo: kobo,
  // Posted to the lot's buyer thread through the message guards (messaging service).
  message: z.string().max(2000).optional(),
});
export type MakeOfferInput = z.infer<typeof makeOfferInput>;

export const respondToOfferInput = z.object({
  decision: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
  counterKobo: kobo.optional(),
  message: z.string().max(2000).optional(),
});
export type RespondToOfferInput = z.infer<typeof respondToOfferInput>;
