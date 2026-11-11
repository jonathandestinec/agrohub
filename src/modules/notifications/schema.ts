import { z } from "zod";
import { NotificationKind } from "@/generated/prisma/enums";

export type AlertKind = NotificationKind;

// What an alert's `data` may hold. Every shape is strict, so a floor price, a phone number or
// bank data cannot be stored by accident. Amounts are decimal strings: Json cannot hold BigInt.
const LOT = z.object({ crop: z.string() }).strict();
const QTY = z.object({ crop: z.string(), quantity: z.number(), unit: z.string() }).strict();
const QTY_DATE = z
  .object({
    crop: z.string(),
    quantity: z.number(),
    unit: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
const MONEY = z.object({ crop: z.string(), amountKobo: z.string().regex(/^\d+$/) }).strict();
const COOP = z.object({ cooperative: z.string() }).strict();
const PERSON = z.object({ name: z.string() }).strict();
const ITEM = z.object({ itemKind: z.enum(["CROP", "UNIT"]), name: z.string() }).strict();
const DATE = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const PROBLEM = z
  .object({
    problem: z.enum(["FAILED", "BLOCKED", "NO_FUNDS", "STALE", "RECONCILIATION", "REFUND_FAILED"]),
  })
  .strict();
const NONE = z.object({}).strict();

export const DATA = {
  LOT_APPROVED: LOT,
  LOT_REJECTED: LOT,
  LOT_COUNTERED: LOT,
  LOT_REVISION_DECIDED: LOT,
  OFFER_NEEDS_FARMER: QTY,
  LOT_ORDER_PAID: QTY,
  PAYOUT_SENT: MONEY,
  MEMBERSHIP_APPROVED: COOP,
  MEMBERSHIP_REJECTED: COOP,
  MEMBERSHIP_REMOVED: COOP,
  BANK_CHANGE_APPLIED: NONE,
  NAME_CHANGE_APPROVED: NONE,
  NAME_CHANGE_REJECTED: NONE,
  CATALOG_REQUEST_APPROVED: ITEM,
  CATALOG_REQUEST_DECLINED: ITEM,
  FARMER_ASKED_TO_JOIN: PERSON,
  FARMER_LEFT: PERSON,
  LOT_SUBMITTED: LOT,
  LOT_REVISION_REQUESTED: LOT,
  LOT_COUNTER_ANSWERED: LOT,
  LOT_WITHDRAWN: LOT,
  CATALOG_REQUEST_MADE: ITEM,
  OFFER_RECEIVED: QTY,
  OFFER_COUNTER_ANSWERED: QTY,
  OFFER_FARMER_ANSWERED: QTY,
  OFFER_WITHDRAWN: QTY,
  ORDER_PAID: QTY,
  ORDER_RECEIPT_CONFIRMED: QTY,
  ORDER_PROBLEM_REPORTED: QTY,
  ORDER_CANCELLED_BY_BUYER: QTY,
  ORDER_CANCEL_REQUESTED: QTY,
  DISPUTE_RESOLVED: QTY,
  COOPERATIVE_VERIFIED: NONE,
  COOPERATIVE_REJECTED: NONE,
  COOPERATIVE_SUSPENDED: NONE,
  COOPERATIVE_REINSTATED: NONE,
  CERTIFICATE_EXPIRING: DATE,
  CERTIFICATE_EXPIRED: DATE,
  OFFER_ACCEPTED: QTY,
  OFFER_COUNTERED: QTY,
  OFFER_DECLINED: QTY,
  OFFER_EXPIRED: QTY,
  DELIVERY_QUOTED: LOT,
  PAYMENT_CONFIRMED: QTY,
  ORDER_PREPARING: QTY,
  DELIVERY_DATE_SET: QTY_DATE,
  ORDER_DELIVERED: QTY,
  ORDER_EXPIRED: QTY,
  ORDER_CANCELLED_BY_COOPERATIVE: QTY,
  CANCEL_REQUEST_AGREED: QTY,
  CANCEL_REQUEST_REFUSED: QTY,
  REFUND_SENT: MONEY,
  COOPERATIVE_SUBMITTED: COOP,
  PAYOUT_PROBLEM: PROBLEM,
  RECONCILIATION_ISSUE: PROBLEM,
  NAME_CHANGE_REQUESTED: NONE,
  BANK_CHANGE_CONFIRMED: NONE,
  CATALOG_REQUEST_FORWARDED: ITEM,
  MESSAGE_RECEIVED: LOT,
} satisfies Record<AlertKind, z.ZodType>;

export type AlertData = { [K in AlertKind]: z.infer<(typeof DATA)[K]> };

export const ALERT_KINDS: readonly AlertKind[] = Object.values(NotificationKind);
