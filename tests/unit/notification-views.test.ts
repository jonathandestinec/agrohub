import { describe, expect, it } from "vitest";
import type { Notification } from "@/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { ALERT_KINDS, DATA } from "@/modules/notifications/schema";
import { hrefOf, toAlertView } from "@/modules/notifications/views";
import en from "../../messages/en.json";

function row(overrides: Partial<Notification>): Notification {
  return {
    id: "n1",
    userId: "u1",
    role: null,
    cooperativeId: null,
    kind: "LOT_APPROVED",
    subjectType: "LOT",
    subjectId: "s1",
    data: {},
    readAt: null,
    createdAt: new Date("2026-11-10T10:00:00Z"),
    ...overrides,
  } as Notification;
}

describe("alert kinds", () => {
  it("every_kind_has_a_sentence_a_parser_and_a_link", () => {
    const sentences = en.alerts.kind as Record<string, string>;
    for (const kind of ALERT_KINDS) {
      expect(sentences[kind], kind).toBeTypeOf("string");
      expect(DATA[kind], kind).toBeDefined();
      expect(hrefOf(kind, "OFFICER", "x1"), kind).toMatch(/^\//);
    }
  });

  it("no_alert_sentence_says_escrow", () => {
    expect(JSON.stringify(en.alerts).toLowerCase()).not.toContain("escrow");
  });

  it("data_shapes_reject_unknown_fields", () => {
    expect(
      DATA.OFFER_RECEIVED.safeParse({ crop: "Maize", quantity: 4, unit: "Bag", floorKobo: 1 }).success,
    ).toBe(false);
    expect(DATA.LOT_APPROVED.safeParse({ crop: "Maize", phone: "0803" }).success).toBe(false);
  });

  it("links_follow_the_role", () => {
    expect(hrefOf("PAYOUT_SENT", "FARMER", "o1")).toBe("/farmer/earnings/o1");
    expect(hrefOf("PAYOUT_SENT", "OFFICER", "o1")).toBe("/officer/orders/o1");
    expect(hrefOf("ORDER_PROBLEM_REPORTED", "ADMIN", "o1")).toBe("/admin/orders/o1");
    expect(hrefOf("DISPUTE_RESOLVED", "BUYER", "o1")).toBe("/buyer/orders/o1");
    expect(hrefOf("MEMBERSHIP_REMOVED", null, "m1")).toBe("/farmer");
  });
});

describe("toAlertView", () => {
  it("formats_a_kobo_amount_held_as_a_string", () => {
    const view = toAlertView(
      row({ kind: "PAYOUT_SENT", role: "FARMER", data: { crop: "Maize", amountKobo: "12500000" } }),
    );
    expect(view.params.amount).toBe(formatNaira(12500000));
    expect(view.params).not.toHaveProperty("amountKobo");
    expect(view.malformed).toBe(false);
  });

  it("flags_malformed_stored_data_instead_of_failing", () => {
    expect(toAlertView(row({ kind: "OFFER_RECEIVED", data: { nonsense: true } }))).toMatchObject({
      params: {},
      malformed: true,
    });
    expect(toAlertView(row({ kind: "BANK_CHANGE_APPLIED", data: {} })).malformed).toBe(false);
  });

  it("formats_a_date_and_maps_read_state_and_link", () => {
    const view = toAlertView(
      row({
        kind: "DELIVERY_DATE_SET",
        role: "BUYER",
        subjectType: "ORDER",
        subjectId: "o9",
        readAt: new Date(),
        data: { crop: "Maize", quantity: 4, unit: "Bag", date: "2026-11-10" },
      }),
    );
    expect(view.params.date).toBe("Nov 10, 2026");
    expect(view).toMatchObject({ read: true, href: "/buyer/orders/o9", createdAt: "2026-11-10T10:00:00.000Z" });
  });
});
