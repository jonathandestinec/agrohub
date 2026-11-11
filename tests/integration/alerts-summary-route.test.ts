import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";
import { notify } from "@/modules/notifications/service";
import { cleanDatabase } from "./helpers";
import { buyerMember } from "./lot-fixtures";

// The route reads the signed-in person through getActor; each test says who that is.
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

const alertFor = (userId: string, id: string) =>
  notify(prisma, {
    kind: "OFFER_ACCEPTED",
    subject: { type: "OFFER", id },
    data: { crop: "Maize", quantity: 4, unit: "Bag" },
    to: [{ userId, role: "BUYER", cooperativeId: null }],
  });

describe("GET /api/alerts/summary", () => {
  it("answers_401_when_signed_out", async () => {
    getActor.mockResolvedValue(null);
    const { GET } = await import("@/app/api/alerts/summary/route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers_401_when_the_second_factor_is_missing", async () => {
    getActor.mockRejectedValue(new ForbiddenError("2FA_REQUIRED"));
    const { GET } = await import("@/app/api/alerts/summary/route");
    expect((await GET()).status).toBe(401);
  });

  it("returns_the_count_and_newest_alerts_for_the_actor", async () => {
    await buyerMember("u-other");
    await alertFor(buyer.userId, "offer-1");
    await alertFor(buyer.userId, "offer-2");
    await alertFor("u-other", "offer-3");
    getActor.mockResolvedValue(buyer);
    const { GET } = await import("@/app/api/alerts/summary/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.unread).toBe(2);
    expect(body.alerts).toHaveLength(2);
    expect(body.alerts[0]).toMatchObject({ kind: "OFFER_ACCEPTED", read: false, href: "/buyer/offers/offer-2" });
    expect(body.alerts[0]).not.toHaveProperty("userId");
  });
});
