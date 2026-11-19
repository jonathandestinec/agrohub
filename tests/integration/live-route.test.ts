import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";
import { alertsVersion, notify } from "@/modules/notifications/service";
import { cleanDatabase } from "./helpers";
import { buyerMember } from "./lot-fixtures";

const getActor = vi.hoisted(() => vi.fn());
vi.mock("@/modules/identity/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/identity/session")>();
  return { ...actual, getActor };
});

let buyer: Actor;

beforeEach(async () => {
  await cleanDatabase();
  getActor.mockReset();
  buyer = await buyerMember("u-buyer");
});

afterAll(cleanDatabase);

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/live/route");
  return POST(new Request("http://localhost/api/live", { method: "POST", body: JSON.stringify(body) }));
};

describe("POST /api/live", () => {
  it("answers_401_when_signed_out", async () => {
    getActor.mockResolvedValue(null);
    const response = await post({ topics: [{ key: "alerts" }] });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers_401_when_the_second_factor_is_missing", async () => {
    getActor.mockRejectedValue(new ForbiddenError("2FA_REQUIRED"));
    expect((await post({ topics: [{ key: "alerts" }] })).status).toBe(401);
  });

  it("answers_400_for_a_bad_key_a_bad_body_or_too_many_topics", async () => {
    getActor.mockResolvedValue(buyer);
    expect((await post({ topics: [{ key: "drop table" }] })).status).toBe(400);
    expect((await post({ topics: [] })).status).toBe(400);
    expect((await post("not an object")).status).toBe(400);
    const seven = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ key: `thread:t${i}` }));
    expect((await post({ topics: seven })).status).toBe(400);
    const { POST } = await import("@/app/api/live/route");
    const broken = await POST(new Request("http://localhost/api/live", { method: "POST", body: "{" }));
    expect(broken.status).toBe(400);
  });

  it("returns_the_version_and_the_summary_when_since_is_missing_or_old", async () => {
    getActor.mockResolvedValue(buyer);
    await notify(prisma, {
      kind: "OFFER_ACCEPTED",
      subject: { type: "OFFER", id: "offer-1" },
      data: { crop: "Maize", quantity: 4, unit: "Bag" },
      to: [{ userId: buyer.userId, role: "BUYER", cooperativeId: null }],
    });
    const response = await post({ topics: [{ key: "alerts" }] });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { topics } = await response.json();
    expect(topics.alerts.version).toBe(await alertsVersion(buyer));
    expect(topics.alerts.data.unread).toBe(1);
    expect(topics.alerts.data.alerts).toHaveLength(1);
    expect(JSON.stringify(topics.alerts.data)).not.toContain("userId");
  });

  it("leaves_out_the_summary_when_since_matches", async () => {
    getActor.mockResolvedValue(buyer);
    const version = await alertsVersion(buyer);
    const { topics } = await (await post({ topics: [{ key: "alerts", since: version }] })).json();
    expect(topics.alerts).toEqual({ version });
  });

  it("one_unknown_topic_does_not_fail_the_others", async () => {
    getActor.mockResolvedValue(buyer);
    const { topics } = await (
      await post({ topics: [{ key: "thread:does-not-exist" }, { key: "alerts" }] })
    ).json();
    expect(topics["thread:does-not-exist"]).toEqual({ error: "not_found" });
    expect(topics.alerts.version).toEqual(expect.any(String));
  });
});
