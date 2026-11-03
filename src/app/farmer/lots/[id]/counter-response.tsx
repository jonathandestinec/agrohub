"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { lotErrorKey } from "@/components/lots/error-key";
import { buttonClass } from "@/components/ui/button";
import { respondToCounterAction } from "../actions";

// Accepting makes the lot live at the counter price; declining withdraws it.
export function CounterResponse({ lotId }: { lotId: string }) {
  const t = useTranslations("lots");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    const result = await respondToCounterAction({ lotId, accept });
    setBusy(false);
    if (!result.ok) {
      setError(t(lotErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} className={`${buttonClass("ink")} w-full`} onClick={() => void answer(true)}>
          {t("counter.accept")}
        </button>
        <button type="button" disabled={busy} className={`${buttonClass("paper")} w-full`} onClick={() => void answer(false)}>
          {t("counter.decline")}
        </button>
      </div>
      <FormError message={error} />
    </div>
  );
}
