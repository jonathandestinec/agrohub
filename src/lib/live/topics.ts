import { z } from "zod";

// The only topic keys the live endpoint accepts. Anything else is a 400, so a client cannot make
// the server run a query it did not plan for.
const ID = "[A-Za-z0-9_-]{1,64}";
const TOPIC_PATTERN = new RegExp(
  `^(?:alerts|threads|thread:${ID}|order:${ID}|offer:${ID}|list:(?:orders|offers)|queue:(?:screening|admin-orders|payouts|verification|names))$`,
);

export const MAX_TOPICS_PER_REQUEST = 6;

export const topicKeySchema = z.string().regex(TOPIC_PATTERN);

export const liveRequestSchema = z.object({
  topics: z
    .array(z.object({ key: topicKeySchema, since: z.string().max(200).optional() }))
    .min(1)
    .max(MAX_TOPICS_PER_REQUEST),
});

export type LiveRequest = z.infer<typeof liveRequestSchema>;

export type QueueName = "screening" | "admin-orders" | "payouts" | "verification" | "names";

export type ParsedTopic =
  | { kind: "alerts" }
  | { kind: "threads" }
  | { kind: "thread" | "order" | "offer"; id: string }
  | { kind: "list"; list: "orders" | "offers" }
  | { kind: "queue"; queue: QueueName };

export function parseTopic(key: string): ParsedTopic | null {
  if (!TOPIC_PATTERN.test(key)) return null;
  if (key === "alerts") return { kind: "alerts" };
  if (key === "threads") return { kind: "threads" };
  const separator = key.indexOf(":");
  const head = key.slice(0, separator);
  const rest = key.slice(separator + 1);
  if (head === "list") return { kind: "list", list: rest as "orders" | "offers" };
  if (head === "queue") return { kind: "queue", queue: rest as QueueName };
  return { kind: head as "thread" | "order" | "offer", id: rest };
}
