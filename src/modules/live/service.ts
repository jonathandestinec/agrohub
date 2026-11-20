import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { parseTopic, type ParsedTopic, type QueueName } from "@/lib/live/topics";
import type { Actor } from "@/modules/identity/policies";
import { screeningVersion } from "@/modules/catalog/service";
import { verificationQueueVersion } from "@/modules/cooperatives/service";
import { offerVersion, offersListVersion } from "@/modules/marketplace/service";
import { inboxVersion, threadVersion } from "@/modules/messaging/service";
import { nameQueueVersion } from "@/modules/name-changes/service";
import { adminOrdersQueueVersion, orderVersion, ordersListVersion } from "@/modules/orders/service";
import { payoutIssuesVersion } from "@/modules/payments/service";
import { alertsVersion, ownAlertsSummary } from "@/modules/notifications/service";
import type { AlertSummary } from "@/modules/notifications/views";

// What the page polls. A version is a string the client compares for equality; it carries no
// message text and no private field. `data` is sent only for the bell, and only when its version
// moved on from the one the client already holds.
export type TopicAnswer = { version: string; data?: AlertSummary } | { error: "forbidden" | "not_found" };

export type TopicRequest = { key: string; since?: string };

// Each owning module checks `can(actor, …)` and scopes by cooperative inside its own version
// function, exactly as its page does; this file only dispatches.
async function answer(actor: Actor, topic: ParsedTopic, since: string | undefined): Promise<TopicAnswer> {
  switch (topic.kind) {
    case "alerts": {
      const version = await alertsVersion(actor);
      if (version === since) return { version };
      return { version, data: await ownAlertsSummary(actor) };
    }
    case "thread":
      return { version: await threadVersion(actor, topic.id) };
    case "threads":
      return { version: await inboxVersion(actor) };
    case "order":
      return { version: await orderVersion(actor, topic.id) };
    case "offer":
      return { version: await offerVersion(actor, topic.id) };
    case "list":
      return { version: topic.list === "orders" ? await ordersListVersion(actor) : await offersListVersion(actor) };
    case "queue":
      return { version: await queueVersion(actor, topic.queue) };
  }
}

function queueVersion(actor: Actor, queue: QueueName): Promise<string> {
  switch (queue) {
    case "screening":
      return screeningVersion(actor);
    case "admin-orders":
      return adminOrdersQueueVersion(actor);
    case "payouts":
      return payoutIssuesVersion(actor);
    case "verification":
      return verificationQueueVersion(actor);
    case "names":
      return nameQueueVersion(actor);
  }
}

// One entry per distinct key (the last one wins). A topic the person may not read, or that does
// not exist, answers with an error of its own and never fails the others. Anything else is a bug
// and propagates.
export async function readTopics(actor: Actor, requests: TopicRequest[]): Promise<Record<string, TopicAnswer>> {
  const distinct = new Map(requests.map((r) => [r.key, r.since]));
  const entries = await Promise.all(
    [...distinct].map(async ([key, since]): Promise<[string, TopicAnswer]> => {
      const topic = parseTopic(key);
      if (!topic) return [key, { error: "not_found" }];
      try {
        return [key, await answer(actor, topic, since)];
      } catch (error) {
        if (error instanceof ForbiddenError) return [key, { error: "forbidden" }];
        if (error instanceof NotFoundError) return [key, { error: "not_found" }];
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// The poll limit. One open tab asks at most every 5 s (12 a minute), and all its topics go in one
// request, so 120 a minute leaves room for about ten busy tabs before anyone is refused. Counted
// per person in Postgres, because on Vercel each serverless instance has its own memory.
export const LIVE_POLLS_PER_WINDOW = 120;
export const LIVE_WINDOW_MS = 60_000;

export type LivePollAllowance = { ok: true } | { ok: false; retryAfterSeconds: number };

// Counts one poll in the person's current fixed window and says whether it may be answered. One
// statement: the upsert takes the row lock, so concurrent polls cannot both slip under the limit.
// Refused polls are counted too; the count only resets when the next window starts.
export async function takeLivePoll(actor: Actor, now: Date = new Date()): Promise<LivePollAllowance> {
  const windowStartMs = Math.floor(now.getTime() / LIVE_WINDOW_MS) * LIVE_WINDOW_MS;
  const windowStart = new Date(windowStartMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "live_poll_window" ("userId", "windowStart", "count")
    VALUES (${actor.userId}, ${windowStart}, 1)
    ON CONFLICT ("userId") DO UPDATE SET
      "count" = CASE WHEN "live_poll_window"."windowStart" = EXCLUDED."windowStart"
                     THEN "live_poll_window"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  if (rows[0].count <= LIVE_POLLS_PER_WINDOW) return { ok: true };
  const msLeft = windowStartMs + LIVE_WINDOW_MS - now.getTime();
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)) };
}
