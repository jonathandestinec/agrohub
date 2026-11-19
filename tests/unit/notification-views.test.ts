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
    expect(hrefOf("MEMBERSHIP_REMOVED", null, "m1")).toBe("/farmer/profile");
    expect(hrefOf("MEMBERSHIP_APPROVED", null, "m1")).toBe("/farmer/profile");
    expect(hrefOf("MEMBERSHIP_REJECTED", null, "m1")).toBe("/farmer/profile");
    expect(hrefOf("CATALOG_REQUEST_APPROVED", null, "c1")).toBe("/farmer/profile");
    expect(hrefOf("CATALOG_REQUEST_DECLINED", null, "c1")).toBe("/farmer/profile");
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

  it("reads_naturally_for_many_and_for_one", () => {
    const sentence = (kind: "ORDER_PAID" | "PAYMENT_CONFIRMED" | "OFFER_RECEIVED", quantity: number, unit: string) => {
      const view = toAlertView(row({ kind, data: { crop: "Maize", quantity, unit } }));
      const template = (en.alerts.kind as Record<string, string>)[kind];
      return template.replace(/\{(\w+)\}/g, (_, k: string) => String(view.params[k]));
    };
    expect(sentence("OFFER_RECEIVED", 50, "Bag")).toBe("New offer for 50 bags of maize.");
    expect(sentence("OFFER_RECEIVED", 1, "Bag")).toBe("New offer for 1 bag of maize.");
    expect(sentence("ORDER_PAID", 3, "100kg bag")).toContain("3 100kg bags of maize");
    expect(sentence("PAYMENT_CONFIRMED", 40, "kg")).toContain("40 kg of maize");
    expect(sentence("PAYMENT_CONFIRMED", 2, "Box")).toContain("2 boxes of maize");
  });

  it("lowercases_the_crop_in_every_sentence_and_leaves_other_params_alone", () => {
    const view = toAlertView(row({ kind: "LOT_APPROVED", data: { crop: "Maize" } }));
    expect(view.params.crop).toBe("maize");
    const dated = toAlertView(
      row({ kind: "DELIVERY_DATE_SET", data: { crop: "Yam", quantity: 1, unit: "Tuber", date: "2026-11-10" } }),
    );
    expect(dated.params).toMatchObject({ crop: "yam", quantity: 1, unit: "tuber", date: "Nov 10, 2026" });
  });

  it("lowercases_a_multi_word_crop", () => {
    const view = toAlertView(row({ kind: "OFFER_RECEIVED", data: { crop: "Ofada Rice", quantity: 2, unit: "50kg bag" } }));
    expect(view.params).toMatchObject({ crop: "ofada rice", unit: "50kg bags" });
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
