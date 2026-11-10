import type { z } from "zod";
import type { NotificationSubjectType } from "@/generated/prisma/client";
import { DATA, type AlertData, type AlertKind } from "./schema";
import type { Db, Recipient } from "./recipients";

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
