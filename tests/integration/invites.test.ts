import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fakeOutbox, sendEmail } from "@/lib/email";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createInviteLink,
  inviteFarmerByEmail,
  regenerateInviteLink,
  resolveInvite,
} from "@/modules/cooperatives/invites";
import type { Actor, Role } from "@/modules/identity/policies";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

const BASE = "http://localhost:3000/join/";
const COOP_NAME = "Ogun Farmers Cooperative Society";

let cooperativeId: string;
let officer: Actor;

function tokenOf(url: string): string {
  expect(url.startsWith(BASE)).toBe(true);
  return url.slice(BASE.length);
}

async function openShareable() {
  return prisma.inviteLink.findMany({
    where: { cooperativeId, email: null, revokedAt: null },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  fakeOutbox.clear();
  vi.mocked(sendEmail).mockClear();
  const coop = await createTestCooperative({ name: COOP_NAME, status: "VERIFIED" });
  cooperativeId = coop.id;
  const user = await createTestUser({ id: "u-officer", email: "officer@example.com" });
  await prisma.membership.create({
    data: { userId: user.id, role: "OFFICER", cooperativeId, status: "ACTIVE" },
  });
  officer = { userId: user.id, role: "OFFICER", cooperativeId, twoFactorEnabled: true };
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("createInviteLink", () => {
  it("returns the same url when called twice", async () => {
    const first = await createInviteLink(officer, cooperativeId);
    const second = await createInviteLink(officer, cooperativeId);
    expect(second.url).toBe(first.url);
    expect(tokenOf(first.url)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await openShareable()).toHaveLength(1);
  });

  it("creates only one open link under concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => createInviteLink(officer, cooperativeId)),
    );
    expect(new Set(results.map((r) => r.url)).size).toBe(1);
    expect(await openShareable()).toHaveLength(1);
  });

  it("works while the cooperative is still pending", async () => {
    await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status: "PENDING" } });
    const { url } = await createInviteLink(officer, cooperativeId);
    expect(tokenOf(url).length).toBe(43);
  });

  it("audits only the first creation, with the invite id and nothing else", async () => {
    await createInviteLink(officer, cooperativeId);
    await createInviteLink(officer, cooperativeId);
    const invite = (await openShareable())[0];
    const rows = await prisma.auditLog.findMany({
      where: { action: "invite.create", entityId: invite.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(invite.id);
    expect(rows[0].meta).toEqual({ inviteId: invite.id });
    expect(rows[0].actorId).toBe(officer.userId);
  });

  it("forbids an officer of another cooperative", async () => {
    const other = await createTestCooperative();
    await expect(createInviteLink(officer, other.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.inviteLink.count()).toBe(0);
  });

  it("forbids every other role", async () => {
    for (const role of ["FARMER", "BUYER", "ADMIN", "BOARD_ADMIN"] as Role[]) {
      await expect(
        createInviteLink({ ...officer, role }, cooperativeId),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("regenerateInviteLink", () => {
  it("revoked_invite_link_is_refused", async () => {
    const old = await createInviteLink(officer, cooperativeId);
    const fresh = await regenerateInviteLink(officer, cooperativeId);
    expect(fresh.url).not.toBe(old.url);
    await expect(resolveInvite(tokenOf(old.url))).rejects.toMatchObject({
      name: "NotFoundError",
      code: "INVITE_INVALID",
    });
    await expect(resolveInvite(tokenOf(fresh.url))).resolves.toEqual({
      cooperativeId,
      cooperativeName: COOP_NAME,
      email: null,
    });
    expect(await openShareable()).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({
      where: { action: "invite.regenerate", entityId: (await openShareable())[0].id },
    });
    expect(audits).toHaveLength(1);
    expect(Object.keys(audits[0].meta as object)).toEqual(["inviteId"]);
  });

  it("creates a link when there was none", async () => {
    const fresh = await regenerateInviteLink(officer, cooperativeId);
    expect(await openShareable()).toHaveLength(1);
    await expect(resolveInvite(tokenOf(fresh.url))).resolves.toBeDefined();
  });

  it("leaves exactly one open link under concurrent calls", async () => {
    await createInviteLink(officer, cooperativeId);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => regenerateInviteLink(officer, cooperativeId)),
    );
    expect(new Set(results.map((r) => r.url)).size).toBe(6);
    expect(await openShareable()).toHaveLength(1);
  });

  it("revokes and creates in one transaction", async () => {
    const old = await createInviteLink(officer, cooperativeId);
    const existing = await prisma.inviteLink.findFirstOrThrow({ where: { cooperativeId } });
    // Temporarily forbid any new open shareable row, so the create fails after the revoke ran.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "invite_link" ADD CONSTRAINT "tmp_no_new_open" CHECK ("revokedAt" IS NOT NULL OR "email" IS NOT NULL OR "id" = '${existing.id}')`,
    );
    try {
      await expect(regenerateInviteLink(officer, cooperativeId)).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "invite_link" DROP CONSTRAINT "tmp_no_new_open"`);
    }
    const open = await openShareable();
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(existing.id);
    await expect(resolveInvite(tokenOf(old.url))).resolves.toBeDefined();
  });

  it("does not touch email invites or other cooperatives", async () => {
    await inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com");
    const otherCoop = await createTestCooperative({ status: "VERIFIED" });
    const otherOfficer: Actor = { ...officer, cooperativeId: otherCoop.id };
    const theirs = await createInviteLink(otherOfficer, otherCoop.id);
    await regenerateInviteLink(officer, cooperativeId);
    expect(
      await prisma.inviteLink.count({
        where: { cooperativeId, email: { not: null }, revokedAt: null },
      }),
    ).toBe(1);
    await expect(resolveInvite(tokenOf(theirs.url))).resolves.toBeDefined();
  });

  it("forbids an officer of another cooperative", async () => {
    const other = await createTestCooperative();
    await expect(regenerateInviteLink(officer, other.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("resolveInvite", () => {
  it("unverified_cooperative_link_refuses_join", async () => {
    const { url } = await createInviteLink(officer, cooperativeId);
    for (const status of ["PENDING", "SUSPENDED"] as const) {
      await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status } });
      await expect(resolveInvite(tokenOf(url))).rejects.toMatchObject({
        name: "ForbiddenError",
        code: "COOPERATIVE_NOT_VERIFIED",
      });
    }
    await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status: "VERIFIED" } });
    await expect(resolveInvite(tokenOf(url))).resolves.toBeDefined();
  });

  it("reports a revoked link as invalid even when the cooperative is unverified", async () => {
    const { url } = await createInviteLink(officer, cooperativeId);
    await regenerateInviteLink(officer, cooperativeId);
    await prisma.cooperative.update({ where: { id: cooperativeId }, data: { status: "PENDING" } });
    await expect(resolveInvite(tokenOf(url))).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });

  it("rejects an unknown or empty token", async () => {
    await expect(resolveInvite("nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveInvite("")).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });

  it("rejects a used link", async () => {
    await inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com");
    const invite = await prisma.inviteLink.findFirstOrThrow({ where: { cooperativeId } });
    await prisma.inviteLink.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    await expect(resolveInvite(invite.token)).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });

  it("does not change anything", async () => {
    const { url } = await createInviteLink(officer, cooperativeId);
    const before = await prisma.inviteLink.findMany();
    const audits = await prisma.auditLog.count();
    await resolveInvite(tokenOf(url), new Date());
    expect(await prisma.inviteLink.findMany()).toEqual(before);
    expect(await prisma.auditLog.count()).toBe(audits);
  });
});

describe("inviteFarmerByEmail", () => {
  it("puts one email with the join url in the outbox", async () => {
    await inviteFarmerByEmail(officer, cooperativeId, "Farmer@Example.com");
    expect(fakeOutbox.sent).toHaveLength(1);
    const invite = await prisma.inviteLink.findFirstOrThrow({ where: { cooperativeId } });
    expect(invite.email).toBe("farmer@example.com");
    expect(invite.createdBy).toBe(officer.userId);
    expect(fakeOutbox.sent[0].to).toBe("farmer@example.com");
    expect(fakeOutbox.sent[0].html).toContain(`${BASE}${invite.token}`);
    expect(fakeOutbox.sent[0].html).toContain(COOP_NAME);
    await expect(resolveInvite(invite.token)).resolves.toMatchObject({
      email: "farmer@example.com",
    });
  });

  it("escapes the cooperative name and never says escrow", async () => {
    await prisma.cooperative.update({
      where: { id: cooperativeId },
      data: { name: 'A & B <script>alert("x")</script>' },
    });
    await inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com");
    const { html, subject } = fakeOutbox.sent[0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(`${subject} ${html}`.toLowerCase()).not.toContain("escrow");
  });

  it("revokes the previous open invite for the same email", async () => {
    await inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com");
    await inviteFarmerByEmail(officer, cooperativeId, "FARMER@example.com");
    const rows = await prisma.inviteLink.findMany({
      where: { cooperativeId, email: "farmer@example.com" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].revokedAt).toBeNull();
    await expect(resolveInvite(rows[0].token)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(resolveInvite(rows[1].token)).resolves.toBeDefined();
  });

  it("does not disturb the shareable link or other emails", async () => {
    const shared = await createInviteLink(officer, cooperativeId);
    await inviteFarmerByEmail(officer, cooperativeId, "a@example.com");
    await inviteFarmerByEmail(officer, cooperativeId, "b@example.com");
    await expect(resolveInvite(tokenOf(shared.url))).resolves.toBeDefined();
    expect(
      await prisma.inviteLink.count({
        where: { cooperativeId, email: { not: null }, revokedAt: null },
      }),
    ).toBe(2);
  });

  it("rejects an invalid email without creating anything", async () => {
    await expect(
      inviteFarmerByEmail(officer, cooperativeId, "not-an-email"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.inviteLink.count()).toBe(0);
    expect(fakeOutbox.sent).toHaveLength(0);
  });

  it("audits without the address", async () => {
    await inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com");
    const invite = await prisma.inviteLink.findFirstOrThrow({ where: { cooperativeId } });
    const rows = await prisma.auditLog.findMany({
      where: { action: "invite.email", entityId: invite.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toEqual({ inviteId: invite.id });
    expect(JSON.stringify(rows)).not.toContain("farmer@example.com");
  });

  it("logs a send failure without the address or the token, and still returns", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      inviteFarmerByEmail(officer, cooperativeId, "farmer@example.com"),
    ).resolves.toBeUndefined();
    const invite = await prisma.inviteLink.findFirstOrThrow({ where: { cooperativeId } });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain("provider down");
    expect(logged).not.toContain("farmer@example.com");
    expect(logged).not.toContain(invite.token);
  });

  it("forbids an officer of another cooperative", async () => {
    const other = await createTestCooperative();
    await expect(
      inviteFarmerByEmail(officer, other.id, "farmer@example.com"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fakeOutbox.sent).toHaveLength(0);
  });
});
