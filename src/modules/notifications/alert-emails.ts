import type { z } from "zod";
import type { NotificationSubjectType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { deferWork } from "@/lib/defer";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { Role } from "@/modules/identity/policies";
import en from "../../../messages/en.json";
import { alertEmail, type Email } from "./emails";
import type { Recipient } from "./recipients";
import { DATA, type AlertData, type AlertKind } from "./schema";
import { hrefOf, paramsOf } from "./views";

// The key events that also email the people involved. Chatty kinds (messages, preparing, new
// offers to officers) stay in-app only. Each entry needs a subject below.
const SUBJECTS: Partial<Record<AlertKind, string>> = {
  PAYMENT_CONFIRMED: "Your payment is held until delivery is confirmed",
  ORDER_PAID: "An order was paid: start preparing it",
  LOT_ORDER_PAID: "An order for your produce was paid",
  DELIVERY_DATE_SET: "Delivery date set for your order",
  ORDER_DELIVERED: "Your order was delivered: please confirm",
  ORDER_RECEIPT_CONFIRMED: "The buyer confirmed receipt",
  PAYOUT_SENT: "Your payout was sent",
  REFUND_SENT: "Your refund was sent",
  ORDER_PROBLEM_REPORTED: "A problem was reported on an order",
  DISPUTE_RESOLVED: "A reported problem was resolved",
  NAME_CHANGE_APPROVED: "Your name change was approved",
  NAME_CHANGE_REJECTED: "Your name change was not approved",
  OFFER_ACCEPTED: "Your offer was accepted",
  OFFER_COUNTERED: "Your offer got a counter price",
  LOT_APPROVED: "Your lot was approved",
  LOT_REJECTED: "Your lot was not approved",
};

export const EMAILED_KINDS: ReadonlySet<AlertKind> = new Set(Object.keys(SUBJECTS) as AlertKind[]);

const SENTENCES = en.alerts.kind as Record<string, string>;

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ""));
}

// Pure: the subject and html for one recipient, or null when the kind is not emailed or the data
// fails its shape. Built only from the same strict `data` shape and the same sentence the bell uses,
// so no floor price, phone number or bank detail can reach an email.
export function buildAlertEmail(
  kind: AlertKind,
  data: unknown,
  role: Role | null,
  subjectId: string,
): Email | null {
  const subject = SUBJECTS[kind];
  const template = SENTENCES[kind];
  if (!subject || !template) return null;
  const parsed = (DATA[kind] as z.ZodType).safeParse(data);
  if (!parsed.success) return null;
  const sentence = fill(template, paramsOf(parsed.data as Record<string, unknown>));
  const href = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}${hrefOf(kind, role, subjectId)}`;
  return alertEmail({ subject, sentence, href });
}

// Emails the people an alert is for. Call it AFTER the transaction that saved the change has
// committed, on the branch where the change happened, so a rolled-back change never emails and a
// replayed event emails once. It schedules a single deferred task that sends one email at a time
// (Resend rate limits), never throws, and logs failures with the kind and subject only.
export async function sendAlertEmail<K extends AlertKind>(input: {
  kind: K;
  subject: { type: NotificationSubjectType; id: string };
  data: AlertData[K];
  to: Recipient[];
  exclude?: string | null;
}): Promise<void> {
  if (!EMAILED_KINDS.has(input.kind)) return;
  const recipients = input.to.filter((r, i, all) => {
    if (r.userId === input.exclude) return false;
    return all.findIndex((o) => o.userId === r.userId && o.role === r.role) === i;
  });
  if (recipients.length === 0) return;

  await deferWork(async () => {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: [...new Set(recipients.map((r) => r.userId))] } },
        select: { id: true, email: true },
      });
      const emailOf = new Map(users.map((u) => [u.id, u.email]));
      for (const r of recipients) {
        const to = emailOf.get(r.userId);
        const mail = buildAlertEmail(input.kind, input.data, r.role, input.subject.id);
        if (!to || !mail) continue;
        try {
          await sendEmail({ to, ...mail });
        } catch (error) {
          logAlertEmailFailure(input.kind, input.subject.id, error);
        }
      }
    } catch (error) {
      logAlertEmailFailure(input.kind, input.subject.id, error);
    }
  });
}

// Never the address or the html.
function logAlertEmailFailure(kind: string, subjectId: string, error: unknown): void {
  console.error("alert email failed", {
    kind,
    subjectId,
    error: error instanceof Error ? { name: error.name, message: error.message } : "non-Error thrown",
  });
}
