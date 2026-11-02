"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { leaveCooperativeAction } from "./actions";
import { errorKey } from "./error-key";

const primary =
  "min-h-11 w-full rounded-md bg-primary px-4 text-base font-semibold text-primary-fg disabled:opacity-60";
const secondary =
  "min-h-11 w-full rounded-md border border-border bg-bg px-4 text-base font-semibold text-fg disabled:opacity-60";

// Leaving keeps the farmer's records, so the confirm step says so.
export function LeaveSection() {
  const t = useTranslations("farmer");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setBusy(true);
    setError(null);
    const outcome = await leaveCooperativeAction();
    setBusy(false);
    if (!outcome.ok) {
      setError(t(errorKey(outcome.code)));
      setConfirming(false);
      return;
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
        {t("leave.heading")}
      </h2>
      <FormError message={error} />
      {confirming ? (
        <div
          role="group"
          aria-label={t("leave.heading")}
          className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3"
        >
          <p className="text-base">{t("leave.warning")}</p>
          <button type="button" onClick={leave} disabled={busy} className={primary}>
            {busy ? t("leave.leaving") : t("leave.confirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className={secondary}
          >
            {t("leave.cancel")}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={secondary}>
          {t("leave.button")}
        </button>
      )}
    </section>
  );
}
