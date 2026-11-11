import type { z } from "zod";
import type { Notification, NotificationSubjectType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, type Actor } from "@/modules/identity/policies";
import { DATA, type AlertData, type AlertKind } from "./schema";
import type { Db, Recipient } from "./recipients";
import { toAlertView, type AlertView } from "./views";

export const ALERTS_PER_PAGE = 20;
const LATEST = 10;

// What the actor sees in the role they are using: their own rows that are for every role or
// for this one, and for no cooperative or for theirs.
function visibleTo(actor: Actor): Prisma.NotificationWhereInput {
  return {
    userId: actor.userId,
    AND: [
      { OR: [{ role: null }, { role: actor.role }] },
      { OR: [{ cooperativeId: null }, ...(actor.cooperativeId ? [{ cooperativeId: actor.cooperativeId }] : [])] },
    ],
  };
}

function requireOwn(actor: Actor, ownerUserId: string): void {
  if (!can(actor, "notification:own", { ownerUserId })) throw new ForbiddenError();
}

export async function countOwnUnread(actor: Actor): Promise<number> {
  requireOwn(actor, actor.userId);
  return prisma.notification.count({ where: { ...visibleTo(actor), readAt: null } });
}

export async function latestOwnAlerts(actor: Actor): Promise<AlertView[]> {
  requireOwn(actor, actor.userId);
  const rows = await prisma.notification.findMany({
    where: visibleTo(actor),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LATEST,
  });
  return rows.map(toAlertView);
}

export async function listOwnAlerts(
  actor: Actor,
  page: number,
): Promise<{ alerts: AlertView[]; page: number; pages: number }> {
  requireOwn(actor, actor.userId);
  const where = visibleTo(actor);
  const total = await prisma.notification.count({ where });
  const pages = Math.max(1, Math.ceil(total / ALERTS_PER_PAGE));
  const wanted = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(wanted, 1), pages);
  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (current - 1) * ALERTS_PER_PAGE,
    take: ALERTS_PER_PAGE,
  });
  return { alerts: rows.map(toAlertView), page: current, pages };
}

export async function markRead(actor: Actor, id: string): Promise<{ href: string }> {
  const row: Notification | null = await prisma.notification.findUnique({ where: { id } });
  if (!row) throw new NotFoundError();
  requireOwn(actor, row.userId);
  // Owned by the actor but for a role or cooperative they are not using: not theirs to open now.
  const visible = await prisma.notification.count({ where: { ...visibleTo(actor), id } });
  if (visible === 0) throw new ForbiddenError();
  await prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  return { href: toAlertView(row).href };
}

export async function markAllRead(actor: Actor): Promise<void> {
  requireOwn(actor, actor.userId);
  await prisma.notification.updateMany({
    where: { ...visibleTo(actor), readAt: null },
    data: { readAt: new Date() },
  });
}

// Writes one alert per recipient. Internal: it takes no Actor, because it is called only from
// other services after their own `can` check, and from webhook and job functions that have none.
// Pass the caller's transaction so the alert is saved with the change or not at all.
export async function notify<K extends AlertKind>(
  db: Db,
  input: {
    kind: K;
    subject: { type: NotificationSubjectType; id: string };
    data: AlertData[K];
    to: Recipient[];
    exclude?: string | null;
  },
): Promise<void> {
  // A bad shape is a programming error: throw, so tests catch it.
  const data = (DATA[input.kind] as z.ZodType).parse(input.data) as object;

  const seen = new Set<string>();
  const recipients = input.to.filter((r) => {
    if (r.userId === input.exclude) return false;
    const key = `${r.userId}|${r.role}|${r.cooperativeId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (recipients.length === 0) return;

  const fresh: Recipient[] = [];
  for (const r of recipients) {
    if (input.kind === "MESSAGE_RECEIVED") {
      // One unread alert per thread: move the existing one to now instead of adding a line.
      const existing = await db.notification.findFirst({
        where: {
          userId: r.userId,
          role: r.role,
          cooperativeId: r.cooperativeId,
          kind: input.kind,
          subjectId: input.subject.id,
          readAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        await db.notification.update({ where: { id: existing.id }, data: { createdAt: new Date() } });
        continue;
      }
    }
    fresh.push(r);
  }
  if (fresh.length === 0) return;

  await db.notification.createMany({
    data: fresh.map((r) => ({
      userId: r.userId,
      role: r.role,
      cooperativeId: r.cooperativeId,
      kind: input.kind,
      subjectType: input.subject.type,
      subjectId: input.subject.id,
      data,
    })),
  });
}

// Callers import the recipient helpers through this file, as modules only import each other
// through service.ts.
export {
  activeAdmins,
  activeBoardAdmins,
  buyer,
  farmer,
  farmersOfLot,
  officersOf,
  person,
  threadAudience,
  type Db,
  type Recipient,
} from "./recipients";
export type { AlertSummary, AlertView } from "./views";
