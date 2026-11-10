"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { orderErrorKey } from "@/components/orders/error-key";
import { payoutOutcomeMessage, type PayoutOutcomeInput } from "@/components/payout-outcome";
import { Button, Card, Chip } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

type Notice = { tone: "good" | "warn" | "bad"; text: string };
const NoticeContext = createContext<(notice: Notice) => void>(() => {});

// Holds the result of the last payout action at the top of the page. A paid payout leaves the
// list, taking its card (and anything the card said) with it, so the message lives here.
export function PayoutFeedback({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <NoticeContext.Provider value={setNotice}>
      <div role="status" aria-live="polite" className="empty:hidden">
        {notice?.tone === "bad" ? (
          <FormError message={notice.text} />
        ) : notice ? (
          <Card tone="paper" className="flex flex-wrap items-center gap-3">
            <Chip tone={notice.tone === "good" ? "lime" : "warn"}>{notice.tone === "good" ? "✓" : "!"}</Chip>
            <p className="body-3">{notice.text}</p>
          </Card>
        ) : null}
      </div>
      {children}
    </NoticeContext.Provider>
  );
}

// One payout action behind a button. `who` names the recipient in the message.
export function PayoutActionButton({
  action,
  label,
  who,
  tone = "ink",
}: {
  action: () => Promise<ActionResult<PayoutOutcomeInput>>;
  label: string;
  who: string;
  tone?: "ink" | "paper";
}) {
  const t = useTranslations("admin.payouts");
  const orders = useTranslations("orders");
  const router = useRouter();
  const report = useContext(NoticeContext);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    let notice: Notice;
    try {
      const result = await action();
      if (!result.ok) {
        notice = { tone: "bad", text: t("actionFailed", { who, reason: orders(orderErrorKey(result.code)) }) };
      } else {
        const message = payoutOutcomeMessage(result.data);
        const reason = message.reasonKey ? t(message.reasonKey) : "";
        notice = { tone: message.tone, text: t(message.key, { who, reason }) };
      }
    } catch {
      // The request itself failed (network, or the server fell over): say so, never nothing.
      notice = { tone: "bad", text: t("actionFailed", { who, reason: orders("errors.INTERNAL") }) };
    }
    setPending(false);
    report(notice);
    router.refresh();
  }

  return (
    <Button type="button" tone={tone} disabled={pending} onClick={onClick}>
      {label}
    </Button>
  );
}
