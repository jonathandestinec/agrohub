import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { grantRole } from "../../scripts/grant-role";

async function clean() {
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await clean();
  await prisma.user.create({
    data: {
      id: "admin-1",
      name: "Ada Admin",
      email: "ada@example.com",
      phone: "+2348012345678",
      consentAcceptedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("grantRole", () => {
  it("creates one ACTIVE ADMIN membership and one membership.grant audit row", async () => {
    const membership = await grantRole({ email: "ada@example.com", role: "ADMIN" });

    expect(membership).toMatchObject({
      userId: "admin-1",
      role: "ADMIN",
      cooperativeId: null,
      status: "ACTIVE",
    });
    expect(await prisma.membership.count({ where: { userId: "admin-1" } })).toBe(1);
    const audits = await prisma.auditLog.findMany({
      where: { entityId: membership.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "membership.grant",
      entity: "membership",
      meta: { role: "ADMIN", status: "ACTIVE" },
    });
  });

  it("matches the email case-insensitively", async () => {
    const membership = await grantRole({ email: " Ada@Example.com ", role: "BOARD_ADMIN" });
    expect(membership).toMatchObject({ userId: "admin-1", role: "BOARD_ADMIN" });
  });

  it("rejects an unknown email with NotFoundError USER_NOT_FOUND", async () => {
    const error = await grantRole({ email: "nobody@example.com", role: "ADMIN" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ code: "USER_NOT_FOUND" });
    expect(await prisma.membership.count()).toBe(0);
  });
});
