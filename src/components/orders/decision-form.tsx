"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { orderErrorKey } from "./error-key";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

type Outcome = "RELEASE" | "REFUND_ALL" | "REFUND_UNITS" | "NOTE";

// An admin's decision on one dispute: the outcome, units for a partial refund, and a note.
export function DecisionForm({
  orderId,
  disputeId,
  outcomes,
  action,
}: {
  orderId: string;
  disputeId: string;
  outcomes: Outcome[];
  action: (input: { orderId: string; disputeId: string; outcome: string; units?: string; note: string }) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations("admin.orders");
  const tOrders = useTranslations("orders");
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>(outcomes[0]);
  const [units, setUnits] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await action({ orderId, disputeId, outcome, units, note });
    setPending(false);
    if (!result.ok) {
      setError(tOrders(orderErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-inner bg-paper/60 p-4 md:p-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="title-2">{t("decide")}</legend>
        {outcomes.map((o) => (
          <label key={o} className="flex min-h-11 items-center gap-3 body-4">
            <input type="radio" name={`outcome-${disputeId}`} value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="size-5" />
            {t(`outcome.${o}`)}
          </label>
        ))}
      </fieldset>
      {outcome === "REFUND_UNITS" ? (
        <label className="flex flex-col gap-1 body-6">
          {t("units")}
          <input name="units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} required className={FIELD} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 body-6">
        {t("note")}
        <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={1000} rows={3} className={`${FIELD} py-2`} />
      </label>
      <FormError message={error} />
      <div>
        <Button type="submit" tone="ink" disabled={pending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
