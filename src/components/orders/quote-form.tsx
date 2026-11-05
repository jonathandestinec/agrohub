"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import { quoteDeliveryAction } from "@/app/officer/quotes/actions";
import { orderErrorKey } from "./error-key";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

// An officer, in a buyer's lot thread, quotes the cost of delivering to that buyer.
export function QuoteForm({ threadId }: { threadId: string }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSent(false);
    const result = await quoteDeliveryAction({ threadId, amount, note });
    setPending(false);
    if (!result.ok) {
      setError(t(orderErrorKey(result.code)));
      return;
    }
    setAmount("");
    setNote("");
    setSent(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-inner bg-paper/60 p-4 md:p-6">
      <h2 className="title-2">{t("quote.heading")}</h2>
      <p className="body-6 text-ink-soft">{t("quote.lead")}</p>
      <label className="flex flex-col gap-1 body-6">
        {t("quote.amount")}
        <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className={FIELD} />
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("quote.note")}
        <input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={FIELD} />
      </label>
      <FormError message={error} />
      {sent ? <p className="body-6" role="status">{t("quote.sent")}</p> : null}
      <div>
        <Button type="submit" tone="ink" disabled={pending}>
          {t("quote.submit")}
        </Button>
      </div>
    </form>
  );
}
