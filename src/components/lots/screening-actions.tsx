"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { lotErrorKey } from "@/components/lots/error-key";
import { buttonClass } from "@/components/ui/button";
import { approveLotAction, counterLotAction, rejectLotAction } from "@/app/officer/lots/actions";

const inputClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";

type Mode = "approve" | "reject" | "counter";

// Approve (with a minimum order), reject with a reason, or counter with a new asking price.
export function ScreeningActions({ lotId, quantity, unit }: { lotId: string; quantity: number; unit: string }) {
  const t = useTranslations("lots.screening");
  const tl = useTranslations("lots");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "");
    setBusy(true);
    setError(null);
    const result =
      mode === "approve"
        ? await approveLotAction({ lotId, minOrderQty: field("minOrderQty") })
        : mode === "reject"
          ? await rejectLotAction({ lotId, reason: field("reason") })
          : await counterLotAction({ lotId, counterAsk: field("counterAsk"), message: field("message") });
    setBusy(false);
    if (!result.ok) {
      setError(tl(lotErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">{t("decide")}</h2>
      <div role="radiogroup" aria-label={t("decide")} className="grid grid-cols-3 gap-2">
        {(["approve", "counter", "reject"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`${buttonClass(mode === m ? "ink" : "paper")} w-full`}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
          >
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "approve" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="minOrderQty" className="title-4">
              {t("minOrder", { unit })}
            </label>
            <input
              id="minOrderQty"
              name="minOrderQty"
              inputMode="numeric"
              defaultValue="1"
              required
              className={inputClass}
            />
            <p className="body-6 text-ink-soft">{t("minOrderHint", { quantity })}</p>
          </div>
        ) : null}
        {mode === "reject" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="reason" className="title-4">
              {t("reason")}
            </label>
            <textarea id="reason" name="reason" rows={3} minLength={3} maxLength={500} required className={inputClass} />
            <p className="body-6 text-ink-soft">{t("reasonHint")}</p>
          </div>
        ) : null}
        {mode === "counter" ? (
          <>
            <div className="flex flex-col gap-2">
              <label htmlFor="counterAsk" className="title-4">
                {t("counterAsk", { unit })}
              </label>
              <input id="counterAsk" name="counterAsk" inputMode="decimal" required className={inputClass} />
              <p className="body-6 text-ink-soft">{t("counterHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="message" className="title-4">
                {t("message")}
              </label>
              <textarea id="message" name="message" rows={2} maxLength={500} className={inputClass} />
            </div>
          </>
        ) : null}
        <FormError message={error} />
        <button type="submit" disabled={busy} className={`${buttonClass("ink")} w-full`}>
          {busy ? t("saving") : t(`confirm.${mode}`)}
        </button>
      </form>
    </section>
  );
}
