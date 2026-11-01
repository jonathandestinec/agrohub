import { z } from "zod";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

const auditInput = z.object({
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
});

// Infrastructure for services: appends one row to the append-only audit log.
export async function recordAudit(input: {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const parsed = auditInput.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid audit entry", "AUDIT_INVALID");
  }
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      meta: input.meta === undefined ? undefined : (input.meta as object),
    },
  });
}
