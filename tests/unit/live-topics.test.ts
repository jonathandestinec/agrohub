import { describe, expect, it } from "vitest";
import { liveRequestSchema, parseTopic } from "@/lib/live/topics";

describe("live topic keys", () => {
  it.each([
    ["alerts", { kind: "alerts" }],
    ["threads", { kind: "threads" }],
    ["thread:abc_123-X", { kind: "thread", id: "abc_123-X" }],
    ["order:o1", { kind: "order", id: "o1" }],
    ["offer:f1", { kind: "offer", id: "f1" }],
    ["list:orders", { kind: "list", list: "orders" }],
    ["list:offers", { kind: "list", list: "offers" }],
    ["queue:admin-orders", { kind: "queue", queue: "admin-orders" }],
  ])("parses %s", (key, expected) => {
    expect(parseTopic(key)).toEqual(expected);
  });

  it.each(["", "thread:", "thread:a b", "thread:../x", "order:a:b", "list:lots", "queue:other", "ALERTS", "alerts "])(
    "refuses %j",
    (key) => {
      expect(parseTopic(key)).toBeNull();
    },
  );

  it("accepts 1 to 6 topics and refuses 0 or 7", () => {
    const topic = (i: number) => ({ key: `thread:t${i}` });
    expect(liveRequestSchema.safeParse({ topics: [] }).success).toBe(false);
    expect(liveRequestSchema.safeParse({ topics: [topic(1)] }).success).toBe(true);
    expect(liveRequestSchema.safeParse({ topics: [1, 2, 3, 4, 5, 6].map(topic) }).success).toBe(true);
    expect(liveRequestSchema.safeParse({ topics: [1, 2, 3, 4, 5, 6, 7].map(topic) }).success).toBe(false);
  });

  it("refuses a bad key inside a request", () => {
    expect(liveRequestSchema.safeParse({ topics: [{ key: "drop table" }] }).success).toBe(false);
  });
});
