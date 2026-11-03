"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { requestErrorKey } from "@/components/catalog-requests/error-key";
import { buttonClass } from "@/components/ui/button";
import type { CatalogItem, OfficerCatalogRequestView } from "@/modules/catalog/views";
import {
  declineCatalogRequestAction,
  forwardCatalogRequestAction,
  matchCatalogRequestAction,
} from "../actions";

const selectClass = "min-h-12 w-full rounded-input bg-paper px-4 body-3 text-ink";
const inputClass = "min-h-12 w-full rounded-input bg-paper px-4 body-3 text-ink";

type Mode = "idle" | "decline" | "match";

function RequestRow({
  request,
  items,
}: {
  request: OfficerCatalogRequestView;
  items: CatalogItem[];
}) {
  const t = useTranslations("catalogRequests");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: () => ReturnType<typeof forwardCatalogRequestAction>) {
    setBusy(true);
    setError(null);
    const outcome = await call();
    setBusy(false);
    if (!outcome.ok) {
      setError(t(requestErrorKey(outcome.code)));
      return;
    }
    router.refresh();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (mode === "decline") {
      void run(() => declineCatalogRequestAction({ id: request.id, reason: String(data.get("reason") ?? "") }));
    } else {
      void run(() => matchCatalogRequestAction({ id: request.id, itemId: String(data.get("itemId") ?? "") }));
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <p className="title-3 break-words">
          {request.name} <span className="body-6 text-ink-soft">({t(`kind.${request.kind}`)})</span>
        </p>
        <p className="body-6 text-ink-soft">{t("officer.askedBy", { name: request.farmerName })}</p>
      </div>
      {mode === "idle" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass("ink")} w-full`}
            onClick={() => void run(() => forwardCatalogRequestAction({ id: request.id }))}
          >
            {t("officer.forward")}
          </button>
          <button
            type="button"
            disabled={busy || items.length === 0}
            className={`${buttonClass("paper")} w-full`}
            onClick={() => setMode("match")}
          >
            {t("officer.match")}
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass("paper")} w-full`}
            onClick={() => setMode("decline")}
          >
            {t("officer.decline")}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {mode === "decline" ? (
            <div className="flex flex-col gap-2">
              <label htmlFor={`reason-${request.id}`} className="title-4">
                {t("officer.reason")}
              </label>
              <input
                id={`reason-${request.id}`}
                name="reason"
                required
                minLength={3}
                maxLength={300}
                className={inputClass}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor={`item-${request.id}`} className="title-4">
                {t("officer.listedAs")}
              </label>
              <select id={`item-${request.id}`} name="itemId" required defaultValue="" className={selectClass}>
                <option value="" disabled>
                  {t("officer.choose")}
                </option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="submit" disabled={busy} className={`${buttonClass("ink")} w-full`}>
              {mode === "decline" ? t("officer.confirmDecline") : t("officer.confirmMatch")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${buttonClass("paper")} w-full`}
              onClick={() => setMode("idle")}
            >
              {t("officer.cancel")}
            </button>
          </div>
        </form>
      )}
      <FormError message={error} />
    </li>
  );
}

// Requests from this cooperative's farmers for crops or units missing from the board's list.
export function CatalogRequestsPanel({
  requests,
  crops,
  units,
}: {
  requests: OfficerCatalogRequestView[];
  crops: CatalogItem[];
  units: CatalogItem[];
}) {
  const t = useTranslations("catalogRequests");
  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">{t("officer.heading")}</h2>
      <p className="body-6 text-ink-soft">{t("officer.intro")}</p>
      {requests.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("officer.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              items={request.kind === "CROP" ? crops : units}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
