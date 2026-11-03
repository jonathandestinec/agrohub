"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { requestErrorKey } from "@/components/catalog-requests/error-key";
import type { CatalogRequestView } from "@/modules/catalog/views";
import { requestCatalogItemAction } from "./actions";

const selectClass = "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink";

// A farmer asks for a crop or unit missing from the board's list; their officer forwards it
// to the price board team. Outcomes show here, since there are no emails yet.
export function CropRequests({ requests }: { requests: CatalogRequestView[] }) {
  const t = useTranslations("catalogRequests");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    setSent(false);
    const result = await requestCatalogItemAction({
      kind: data.get("kind") === "UNIT" ? "UNIT" : "CROP",
      name: String(data.get("name") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(t(requestErrorKey(result.code)));
      return;
    }
    setSent(true);
    form.reset();
    router.refresh();
  }

  function statusText(request: CatalogRequestView): string {
    switch (request.status) {
      case "WITH_OFFICER":
        return t("status.WITH_OFFICER");
      case "FORWARDED":
        return t("status.FORWARDED");
      case "APPROVED":
        return t("status.APPROVED", { name: request.resolvedItemName ?? request.name });
      case "DECLINED":
        return t("status.DECLINED", { reason: request.declineReason ?? "" });
    }
  }

  return (
    <section id="crop-requests" className="flex scroll-mt-24 flex-col gap-4">
      <h2 className="heading-6">{t("farmer.heading")}</h2>
      <p className="body-6 text-ink-soft">{t("farmer.intro")}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="request-kind" className="title-4">
            {t("farmer.kind")}
          </label>
          <select id="request-kind" name="kind" defaultValue="CROP" className={selectClass}>
            <option value="CROP">{t("kind.CROP")}</option>
            <option value="UNIT">{t("kind.UNIT")}</option>
          </select>
        </div>
        <Field id="request-name" name="name" label={t("farmer.name")} maxLength={60} required />
        <FormError message={error} />
        {sent ? (
          <p role="status" className="body-6 text-ink-soft">
            {t("farmer.sent")}
          </p>
        ) : null}
        <SubmitButton pending={pending} label={t("farmer.send")} pendingLabel={t("farmer.sending")} />
      </form>
      {requests.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={t("farmer.yourRequests")}>
          {requests.map((request) => (
            <li key={request.id} className="flex flex-col gap-1 rounded-inner bg-step p-4">
              <span className="title-4 break-words">
                {request.name} <span className="body-6 text-ink-soft">({t(`kind.${request.kind}`)})</span>
              </span>
              <span className="body-6 text-ink-soft break-words">{statusText(request)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
