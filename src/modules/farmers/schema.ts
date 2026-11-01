import { z } from "zod";
import { STATES } from "@/modules/geo/states";

// Hectares as a decimal string with at most two places; compared as integer hundredths,
// never as a float.
const MAX_FARM_SIZE_HUNDREDTHS = 100_000 * 100;

function toHundredths(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const farmSize = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Farm size must be a number with at most 2 decimals")
  .refine((value) => {
    const hundredths = toHundredths(value);
    return hundredths > 0 && hundredths <= MAX_FARM_SIZE_HUNDREDTHS;
  }, "Farm size must be more than 0 and at most 100000 hectares");

export const farmerProfileInput = z.object({
  farmSizeHectares: farmSize,
  crops: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  state: z.enum(STATES),
  lga: z.string().trim().min(1).max(80),
});

// state is a plain string at the boundary; the schema narrows it to a known state.
export type FarmerProfileInput = {
  farmSizeHectares: string;
  crops: string[];
  state: string;
  lga: string;
};

// The join form sends crops as one comma-separated field.
export function splitCrops(value: string): string[] {
  return value
    .split(",")
    .map((crop) => crop.trim())
    .filter((crop) => crop.length > 0);
}
