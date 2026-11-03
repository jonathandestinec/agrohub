import { z } from "zod";

const bps = (min: number, max: number) => z.number().int().min(min).max(max);

// Bounds an admin can set. The fee and the maximum cut are each at most 50%, so a farmer
// always keeps something; the threshold is at least 1%.
export const platformSettingsInput = z.object({
  platformFeeBps: bps(0, 5000),
  maxCooperativeCutBps: bps(0, 5000),
  priceDeviationBps: bps(100, 10000),
});

export type PlatformSettings = z.infer<typeof platformSettingsInput>;
