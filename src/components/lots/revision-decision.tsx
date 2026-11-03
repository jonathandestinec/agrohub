"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { lotErrorKey } from "@/components/lots/error-key";
import { buttonClass } from "@/components/ui/button";
import { decideRevisionAction } from "@/app/officer/lots/actions";

const inputClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";

// Approve or reject a farmer's change to a live lot.
export function RevisionDecision({ lotId, revisionId }: { lotId: string; revisionId: string }) {
  const t = useTranslations("lots");
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean, reason?: string) {
    setBusy(true);
    setError(null);
    const result = await decideRevisionAction({ lotId, revisionId, approve, reason });
    setBusy(false);
    if (!result.ok) {
      setError(t(lotErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  function onReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void decide(false, String(new FormData(event.currentTarget).get("reason") ?? ""));
  }

  return (
    <div className="flex flex-col gap-3">
      {rejecting ? (
        <form onSubmit={onReject} className="flex flex-col gap-3">
          <label htmlFor="revision-reason" className="title-4">
            {t("screening.reason")}
          </label>
          <textarea id="revision-reason" name="reason" rows={2} minLength={3} maxLength={500} required className={inputClass} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="submit" disabled={busy} className={`${buttonClass("ink")} w-full`}>
              {t("revision.reject")}
            </button>
            <button type="button" disabled={busy} className={`${buttonClass("paper")} w-full`} onClick={() => setRejecting(false)}>
              {t("revision.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy} className={`${buttonClass("ink")} w-full`} onClick={() => void decide(true)}>
            {t("revision.approve")}
          </button>
          <button type="button" disabled={busy} className={`${buttonClass("paper")} w-full`} onClick={() => setRejecting(true)}>
            {t("revision.reject")}
          </button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
