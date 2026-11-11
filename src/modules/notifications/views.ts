import type { Notification } from "@/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import type { Role } from "@/modules/identity/policies";
import { DATA, type AlertKind } from "./schema";

export type AlertView = {
  id: string;
  kind: AlertKind;
  params: Record<string, string | number>;
  // The stored data failed its kind's parser: the interface shows alerts.fallback.
  malformed: boolean;
  href: string;
  read: boolean;
  createdAt: string; // ISO
};

type Link = (role: Role | null, id: string) => string;

const to =
  (path: string): Link =>
  () =>
    path;
const withId =
  (prefix: string): Link =>
  (_role, id) =>
    `${prefix}/${id}`;

const LINKS: Record<AlertKind, Link> = {
  LOT_APPROVED: withId("/farmer/lots"),
  LOT_REJECTED: withId("/farmer/lots"),
  LOT_COUNTERED: withId("/farmer/lots"),
  LOT_REVISION_DECIDED: withId("/farmer/lots"),
  OFFER_NEEDS_FARMER: withId("/farmer/lots"),
  LOT_ORDER_PAID: withId("/farmer/earnings"),
  PAYOUT_SENT: (role, id) =>
    role === "OFFICER" ? `/officer/orders/${id}` : `/farmer/earnings/${id}`,
  MEMBERSHIP_APPROVED: to("/farmer"),
  MEMBERSHIP_REJECTED: to("/farmer"),
  MEMBERSHIP_REMOVED: to("/farmer"),
  BANK_CHANGE_APPLIED: to("/account"),
  NAME_CHANGE_APPROVED: to("/account"),
  NAME_CHANGE_REJECTED: to("/account"),
  CATALOG_REQUEST_APPROVED: to("/farmer"),
  CATALOG_REQUEST_DECLINED: to("/farmer"),
  FARMER_ASKED_TO_JOIN: to("/officer/farmers"),
  FARMER_LEFT: to("/officer/farmers"),
  LOT_SUBMITTED: withId("/officer/lots"),
  LOT_REVISION_REQUESTED: withId("/officer/lots"),
  LOT_COUNTER_ANSWERED: withId("/officer/lots"),
  LOT_WITHDRAWN: withId("/officer/lots"),
  CATALOG_REQUEST_MADE: to("/officer/lots"),
  OFFER_RECEIVED: withId("/officer/offers"),
  OFFER_COUNTER_ANSWERED: withId("/officer/offers"),
  OFFER_FARMER_ANSWERED: withId("/officer/offers"),
  OFFER_WITHDRAWN: withId("/officer/offers"),
  ORDER_PAID: withId("/officer/orders"),
  ORDER_RECEIPT_CONFIRMED: withId("/officer/orders"),
  ORDER_PROBLEM_REPORTED: (role, id) =>
    role === "ADMIN" ? `/admin/orders/${id}` : `/officer/orders/${id}`,
  ORDER_CANCELLED_BY_BUYER: withId("/officer/orders"),
  ORDER_CANCEL_REQUESTED: withId("/officer/orders"),
  DISPUTE_RESOLVED: (role, id) =>
    role === "BUYER" ? `/buyer/orders/${id}` : `/officer/orders/${id}`,
  COOPERATIVE_VERIFIED: to("/officer/onboarding"),
  COOPERATIVE_REJECTED: to("/officer/onboarding"),
  COOPERATIVE_SUSPENDED: to("/officer/onboarding"),
  COOPERATIVE_REINSTATED: to("/officer/onboarding"),
  CERTIFICATE_EXPIRING: to("/officer/onboarding"),
  CERTIFICATE_EXPIRED: to("/officer/onboarding"),
  OFFER_ACCEPTED: withId("/buyer/offers"),
  OFFER_COUNTERED: withId("/buyer/offers"),
  OFFER_DECLINED: withId("/buyer/offers"),
  OFFER_EXPIRED: withId("/buyer/offers"),
  DELIVERY_QUOTED: withId("/messages"),
  PAYMENT_CONFIRMED: withId("/buyer/orders"),
  ORDER_PREPARING: withId("/buyer/orders"),
  DELIVERY_DATE_SET: withId("/buyer/orders"),
  ORDER_DELIVERED: withId("/buyer/orders"),
  ORDER_EXPIRED: withId("/buyer/orders"),
  ORDER_CANCELLED_BY_COOPERATIVE: withId("/buyer/orders"),
  CANCEL_REQUEST_AGREED: withId("/buyer/orders"),
  CANCEL_REQUEST_REFUSED: withId("/buyer/orders"),
  REFUND_SENT: withId("/buyer/orders"),
  COOPERATIVE_SUBMITTED: withId("/admin/cooperatives"),
  PAYOUT_PROBLEM: to("/admin/payouts"),
  // The subject can be a Paystack reference rather than an order id, so this opens the list.
  RECONCILIATION_ISSUE: to("/admin/orders"),
  NAME_CHANGE_REQUESTED: withId("/admin/names"),
  BANK_CHANGE_CONFIRMED: to("/admin/payouts"),
  CATALOG_REQUEST_FORWARDED: to("/board"),
  MESSAGE_RECEIVED: withId("/messages"),
};

export function hrefOf(kind: AlertKind, role: Role | null, subjectId: string): string {
  return LINKS[kind](role, subjectId);
}

// Delivery dates are Lagos calendar days stored as YYYY-MM-DD, shown like the order pages do.
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

function paramsOf(data: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "amountKobo") params.amount = formatNaira(Number(value));
    else if (key === "date") params.date = day.format(new Date(`${String(value)}T00:00:00Z`));
    else params[key] = value as string | number;
  }
  return params;
}

export function toAlertView(row: Notification): AlertView {
  const parsed = DATA[row.kind].safeParse(row.data);
  return {
    id: row.id,
    kind: row.kind,
    params: parsed.success ? paramsOf(parsed.data as Record<string, unknown>) : {},
    malformed: !parsed.success,
    href: hrefOf(row.kind, row.role, row.subjectId),
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

// What the bell shows: the unread count and the five newest alerts.
export type AlertSummary = { unread: number; alerts: AlertView[] };
