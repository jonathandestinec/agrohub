import { z } from "zod";
import { STATES } from "@/modules/geo/states";

export const DOCUMENT_KINDS = [
  "REGISTRATION_CERTIFICATE",
  "BYLAWS",
  "OFFICER_LIST",
] as const;

export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_DOCUMENT_BYTES = 10_485_760;

export const createCooperativeInput = z.object({
  name: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().min(2).max(60),
  state: z.enum(STATES),
  lga: z.string().trim().min(2).max(80),
  certificateExpiresAt: z.date(),
});

// state is a plain string at the boundary; the schema narrows it to a known state.
export type CreateCooperativeInput = Omit<
  z.infer<typeof createCooperativeInput>,
  "state"
> & { state: string };

export const documentKind = z.enum(DOCUMENT_KINDS);

// reviewNote value set when a verified cooperative lapses; the UI maps it to a friendly message.
export const CERTIFICATE_EXPIRED_NOTE = "CERTIFICATE_EXPIRED";
