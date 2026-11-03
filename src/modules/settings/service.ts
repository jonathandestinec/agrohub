import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { parseBps } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { platformSettingsInput, type PlatformSettings } from "./schema";

export type { PlatformSettings };

export const SETTING_KEYS: Record<keyof PlatformSettings, string> = {
  platformFeeBps: "platform_fee_bps",
  maxCooperativeCutBps: "max_cooperative_cut_bps",
  priceDeviationBps: "price_deviation_bps",
};

// Used while no admin has stored a value. The deviation default was the Phase 2 constant
// DEFAULT_DEVIATION_THRESHOLD_BPS.
export const DEFAULT_SETTINGS: PlatformSettings = {
  platformFeeBps: 300,
  maxCooperativeCutBps: 500,
  priceDeviationBps: 2000,
};

const FIELDS = Object.keys(SETTING_KEYS) as Array<keyof PlatformSettings>;

// No Actor: these are the public terms every farmer is quoted. A stored value that is not
// valid basis points throws, so a corrupt row never quotes wrong terms.
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(SETTING_KEYS) } } });
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const settings = { ...DEFAULT_SETTINGS };
  for (const field of FIELDS) {
    const value = stored.get(SETTING_KEYS[field]);
    if (value !== undefined) settings[field] = parseBps(value);
  }
  return settings;
}

export async function updatePlatformSettings(
  actor: Actor,
  input: PlatformSettings,
): Promise<PlatformSettings> {
  if (!can(actor, "setting:write")) throw new ForbiddenError();
  const parsed = platformSettingsInput.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid setting", "INVALID_SETTING");
  const next = parsed.data;

  const current = await getPlatformSettings();
  const changed = FIELDS.filter((field) => current[field] !== next[field]);
  if (changed.length === 0) return current;

  await prisma.$transaction(async (tx) => {
    for (const field of changed) {
      const key = SETTING_KEYS[field];
      const value = String(next[field]);
      await tx.setting.upsert({
        where: { key },
        create: { key, value, updatedByUserId: actor.userId },
        update: { value, updatedByUserId: actor.userId },
      });
      await recordAudit(
        {
          actorId: actor.userId,
          action: "setting.update",
          entity: "setting",
          entityId: key,
          meta: { key, fromBps: current[field], toBps: next[field] },
        },
        tx,
      );
    }
  });
  return next;
}
