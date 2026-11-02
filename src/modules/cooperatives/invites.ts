import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { InviteLink } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { recordAudit } from "@/modules/audit/audit";
import { can, type Actor } from "@/modules/identity/policies";
import { farmerInviteEmail } from "@/modules/notifications/emails";

// A token is the credential: it is never logged and never put in an audit row.
const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 200;
const MAX_ATTEMPTS = 3;

const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function joinUrl(token: string): string {
  return `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/join/${token}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// Officers may prepare links while the cooperative is still PENDING;
// joining is gated on VERIFIED in resolveInvite.
async function requireInviteAccess(
  actor: Actor,
  cooperativeId: string,
): Promise<void> {
  if (!can(actor, "invite:manage", { cooperativeId })) {
    throw new ForbiddenError();
  }
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    select: { id: true },
  });
  if (!cooperative) throw new NotFoundError("COOPERATIVE_NOT_FOUND");
}

function findOpenShareable(cooperativeId: string): Promise<InviteLink | null> {
  return prisma.inviteLink.findFirst({
    where: { cooperativeId, email: null, revokedAt: null },
  });
}

// Returns the cooperative's current open shareable link, or creates one. A partial
// unique index allows only one open shareable link, so of two concurrent callers the
// loser gets P2002 and returns the winner's link.
export async function createInviteLink(
  actor: Actor,
  cooperativeId: string,
): Promise<{ url: string }> {
  await requireInviteAccess(actor, cooperativeId);
  const existing = await findOpenShareable(cooperativeId);
  if (existing) return { url: joinUrl(existing.token) };
  let created: InviteLink;
  try {
    created = await prisma.inviteLink.create({
      data: { cooperativeId, token: newToken(), createdBy: actor.userId },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findOpenShareable(cooperativeId);
    if (!winner) throw error;
    return { url: joinUrl(winner.token) };
  }
  await recordAudit({
    actorId: actor.userId,
    action: "invite.create",
    entity: "invite_link",
    entityId: created.id,
    meta: { inviteId: created.id },
  });
  return { url: joinUrl(created.token) };
}

// Revokes every open shareable link and creates a new one in one transaction, so the
// cooperative is never left with no link or with two. The advisory lock serialises
// concurrent regenerations for the same cooperative; the retry covers a concurrent
// createInviteLink inserting between the revoke and the create.
export async function regenerateInviteLink(
  actor: Actor,
  cooperativeId: string,
): Promise<{ url: string }> {
  await requireInviteAccess(actor, cooperativeId);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${cooperativeId}`}))`;
        await tx.inviteLink.updateMany({
          where: { cooperativeId, email: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return tx.inviteLink.create({
          data: { cooperativeId, token: newToken(), createdBy: actor.userId },
        });
      });
      await recordAudit({
        actorId: actor.userId,
        action: "invite.regenerate",
        entity: "invite_link",
        entityId: created.id,
        meta: { inviteId: created.id },
      });
      return { url: joinUrl(created.token) };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

function logEmailFailure(
  cooperativeId: string,
  inviteId: string,
  err: unknown,
): void {
  // Never log the recipient, the link or the html.
  console.error("invite email failed", {
    cooperativeId,
    inviteId,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message }
        : "non-Error thrown",
  });
}

// Creates a single-use invite bound to one email (Task 8 marks usedAt) and emails it.
// A newer invite to the same address replaces the older one. A failed send is logged
// and does not fail the call: the invite exists and the officer can invite again.
export async function inviteFarmerByEmail(
  actor: Actor,
  cooperativeId: string,
  email: string,
): Promise<void> {
  await requireInviteAccess(actor, cooperativeId);
  const parsed = emailInput.safeParse(email);
  if (!parsed.success) {
    throw new ValidationError("Enter a valid email address", "INVALID_EMAIL");
  }
  const address = parsed.data;
  const invite = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${cooperativeId}:${address}`}))`;
    await tx.inviteLink.updateMany({
      where: { cooperativeId, email: address, revokedAt: null, usedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.inviteLink.create({
      data: {
        cooperativeId,
        token: newToken(),
        email: address,
        createdBy: actor.userId,
      },
    });
  });
  await recordAudit({
    actorId: actor.userId,
    action: "invite.email",
    entity: "invite_link",
    entityId: invite.id,
    meta: { inviteId: invite.id },
  });
  try {
    const cooperative = await prisma.cooperative.findUniqueOrThrow({
      where: { id: cooperativeId },
      select: { name: true },
    });
    const { subject, html } = farmerInviteEmail({
      cooperativeName: cooperative.name,
      link: joinUrl(invite.token),
    });
    await sendEmail({ to: address, subject, html });
  } catch (err) {
    logEmailFailure(cooperativeId, invite.id, err);
  }
}

// Pure lookup for the join flow: no side effects, so opening a link never uses it up.
// Invites do not expire by time. An unusable link is reported before the cooperative's
// status, so a revoked link never reveals whether its cooperative is verified.
// `now` is accepted for a uniform signature with the other lookups.
export async function resolveInvite(
  token: string,
  now: Date = new Date(),
): Promise<{
  cooperativeId: string;
  cooperativeName: string;
  email: string | null;
}> {
  void now;
  const invite =
    token.length > 0 && token.length <= MAX_TOKEN_LENGTH
      ? await prisma.inviteLink.findUnique({
          where: { token },
          include: { cooperative: { select: { name: true, status: true } } },
        })
      : null;
  if (!invite || invite.revokedAt !== null || invite.usedAt !== null) {
    throw new NotFoundError("INVITE_INVALID");
  }
  if (invite.cooperative.status !== "VERIFIED") {
    throw new ForbiddenError("COOPERATIVE_NOT_VERIFIED");
  }
  return {
    cooperativeId: invite.cooperativeId,
    cooperativeName: invite.cooperative.name,
    email: invite.email,
  };
}
