import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { parseTopic, type ParsedTopic } from "@/lib/live/topics";
import type { Actor } from "@/modules/identity/policies";
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
    default:
      // Topics added by later tasks.
      throw new NotFoundError();
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
