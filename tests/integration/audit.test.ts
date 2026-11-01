import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";

// Audit rows can never be cleaned (that is the point), so every test uses a
// unique entityId and queries by it.

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordAudit", () => {
  it("inserts exactly one row with the given fields", async () => {
    const entityId = randomUUID();
    await recordAudit({
      actorId: "u1",
      action: "price.changed",
      entity: "listing",
      entityId,
      meta: { from: 1000, to: 1200, nested: { ok: true } },
    });
    const rows = await prisma.auditLog.findMany({ where: { entityId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: "u1",
      action: "price.changed",
      entity: "listing",
      entityId,
      meta: { from: 1000, to: 1200, nested: { ok: true } },
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("accepts a null actor and no meta", async () => {
    const entityId = randomUUID();
    await recordAudit({
      actorId: null,
      action: "system.tick",
      entity: "job",
      entityId,
    });
    const rows = await prisma.auditLog.findMany({ where: { entityId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].meta).toBeNull();
  });

  it("rejects empty action, entity or entityId", async () => {
    const base = { actorId: null, action: "a", entity: "e", entityId: "x" };
    await expect(recordAudit({ ...base, action: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(recordAudit({ ...base, entity: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(recordAudit({ ...base, entityId: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("audit_rows_are_immutable", () => {
  async function seed() {
    const entityId = randomUUID();
    await recordAudit({
      actorId: "u1",
      action: "role.changed",
      entity: "membership",
      entityId,
      meta: { role: "FARMER" },
    });
    const [row] = await prisma.auditLog.findMany({ where: { entityId } });
    return row;
  }

  it("rejects a raw UPDATE and leaves the row unchanged", async () => {
    const row = await seed();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "audit_log" SET "action" = 'tampered' WHERE "id" = $1`,
        row.id,
      ),
    ).rejects.toThrow(/audit_log is append-only/);
    const after = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(after).toEqual(row);
  });

  it("rejects a raw DELETE and leaves the row in place", async () => {
    const row = await seed();
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "audit_log" WHERE "id" = $1`,
        row.id,
      ),
    ).rejects.toThrow(/audit_log is append-only/);
    const after = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(after).toEqual(row);
  });

  it("rejects TRUNCATE", async () => {
    const row = await seed();
    await expect(
      prisma.$executeRawUnsafe(`TRUNCATE TABLE "audit_log"`),
    ).rejects.toThrow(/audit_log is append-only/);
    const after = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(after).toEqual(row);
  });
});
