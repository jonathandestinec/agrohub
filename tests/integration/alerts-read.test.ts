import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor } from "@/modules/identity/policies";
import { person } from "@/modules/notifications/recipients";
import {
  ALERTS_PER_PAGE,
  countOwnUnread,
  latestOwnAlerts,
  listOwnAlerts,
  markAllRead,
  markRead,
  notify,
} from "@/modules/notifications/service";
import { alertsFor } from "./alert-helpers";
import { cleanDatabase, createTestUser } from "./helpers";
import { lotWorld, type LotWorld } from "./lot-fixtures";

let w: LotWorld;
let asOfficer: Actor;
// The same person using their buyer role.
let asBuyer: Actor;

beforeEach(async () => {
  await cleanDatabase();
  w = await lotWorld();
  asOfficer = w.officer;
  asBuyer = { userId: w.officer.userId, role: "BUYER", cooperativeId: null, twoFactorEnabled: false };
});

afterAll(cleanDatabase);

const officerAlert = (userId = w.officer.userId, cooperativeId = w.cooperativeId, id = "lot-1") =>
  notify(prisma, {
    kind: "LOT_SUBMITTED",
    subject: { type: "LOT", id },
    data: { crop: "Maize" },
    to: [{ userId, role: "OFFICER", cooperativeId }],
  });
const buyerAlert = (userId = w.officer.userId) =>
  notify(prisma, {
    kind: "OFFER_ACCEPTED",
    subject: { type: "OFFER", id: "offer-1" },
    data: { crop: "Maize", quantity: 4, unit: "Bag" },
    to: [{ userId, role: "BUYER", cooperativeId: null }],
  });

async function seedMany(count: number) {
  const base = Date.now();
  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId: w.officer.userId,
      role: "OFFICER" as const,
      cooperativeId: w.cooperativeId,
      kind: "LOT_SUBMITTED" as const,
      subjectType: "LOT" as const,
      subjectId: `lot-${i}`,
      data: { crop: "Maize" },
      createdAt: new Date(base + i * 1000),
    })),
  });
}

describe("reading alerts", () => {
  it("counts_and_lists_only_the_alerts_of_the_role_in_use", async () => {
    await officerAlert();
    await buyerAlert();
    expect(await countOwnUnread(asBuyer)).toBe(1);
    expect((await latestOwnAlerts(asOfficer)).map((a) => a.kind)).toEqual(["LOT_SUBMITTED"]);
    expect((await latestOwnAlerts(asBuyer)).map((a) => a.kind)).toEqual(["OFFER_ACCEPTED"]);
  });

  it("shows_personal_alerts_under_every_role", async () => {
    await notify(prisma, {
      kind: "MEMBERSHIP_REMOVED",
      subject: { type: "MEMBERSHIP", id: "m1" },
      data: { cooperative: "Zuma Farmers" },
      to: [person(w.officer.userId)],
    });
    expect(await countOwnUnread(asBuyer)).toBe(1);
    expect(await countOwnUnread(asOfficer)).toBe(1);
  });

  it("hides_an_officers_alerts_for_another_cooperative", async () => {
    await officerAlert(w.officer.userId, "another-cooperative");
    expect(await countOwnUnread(asOfficer)).toBe(0);
  });

  it("returns_the_ten_newest_first", async () => {
    await seedMany(12);
    const alerts = await latestOwnAlerts(asOfficer);
    expect(alerts).toHaveLength(10);
    expect(alerts.map((a) => a.createdAt)).toEqual([...alerts.map((a) => a.createdAt)].sort().reverse());
    expect(alerts[0].href).toBe("/officer/lots/lot-11");
  });

  it("pages_twenty_at_a_time_and_clamps_the_page", async () => {
    await seedMany(45);
    expect(ALERTS_PER_PAGE).toBe(20);
    expect((await listOwnAlerts(asOfficer, 1)).alerts).toHaveLength(20);
    expect((await listOwnAlerts(asOfficer, 3)).alerts).toHaveLength(5);
    expect(await listOwnAlerts(asOfficer, 99)).toMatchObject({ page: 3, pages: 3 });
    expect((await listOwnAlerts(asOfficer, 0)).page).toBe(1);
    expect((await listOwnAlerts(asOfficer, -3)).page).toBe(1);
    expect((await listOwnAlerts(asOfficer, Number.NaN)).page).toBe(1);
    expect((await listOwnAlerts(asOfficer, 2.7)).page).toBe(2);
  });

  it("gives_one_page_when_there_are_no_alerts", async () => {
    expect(await listOwnAlerts(asOfficer, 1)).toEqual({ alerts: [], page: 1, pages: 1 });
  });
});

describe("marking alerts", () => {
  it("marks_one_read_and_returns_its_link", async () => {
    await officerAlert();
    await officerAlert(w.officer.userId, w.cooperativeId, "lot-2");
    const [row] = await alertsFor(w.officer.userId);
    const result = await markRead(asOfficer, row.id);
    expect(result.href).toBe(`/officer/lots/${row.subjectId}`);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).not.toBeNull();
    expect(await countOwnUnread(asOfficer)).toBe(1);
  });

  it("leaves_the_time_of_an_already_read_alert_alone", async () => {
    await officerAlert();
    const [row] = await alertsFor(w.officer.userId);
    await markRead(asOfficer, row.id);
    const first = (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markRead(asOfficer, row.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toEqual(first);
  });

  it("refuses_to_mark_another_persons_alert", async () => {
    await createTestUser({ id: "someone-else" });
    await officerAlert("someone-else");
    const [row] = await alertsFor("someone-else");
    await expect(markRead(asOfficer, row.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
  });

  it("refuses_to_mark_an_alert_for_a_role_not_in_use", async () => {
    await buyerAlert();
    const [row] = await alertsFor(w.officer.userId);
    await expect(markRead(asOfficer, row.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
  });

  it("says_not_found_for_an_unknown_id", async () => {
    await expect(markRead(asOfficer, "no-such-alert")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("marks_all_read_for_the_role_in_use_only", async () => {
    await officerAlert();
    await buyerAlert();
    await markAllRead(asOfficer);
    expect(await countOwnUnread(asOfficer)).toBe(0);
    expect(await countOwnUnread(asBuyer)).toBe(1);
  });
});
