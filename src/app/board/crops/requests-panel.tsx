"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { requestErrorKey } from "@/components/catalog-requests/error-key";
import { buttonClass } from "@/components/ui/button";
import type { BoardCatalogRequestGroup } from "@/modules/catalog/views";
import { approveCatalogRequestAction, declineCatalogRequestAction } from "../actions";

const inputClass = "min-h-12 w-full rounded-input bg-paper px-4 body-3 text-ink";

function GroupRow({ group }: { group: BoardCatalogRequestGroup }) {
  const t = useTranslations("catalogRequests");
  const locale = useLocale();
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: () => ReturnType<typeof approveCatalogRequestAction>) {
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
    if (declining) {
      void run(() => declineCatalogRequestAction({ id: group.id, reason: String(data.get("reason") ?? "") }));
    } else {
      void run(() => approveCatalogRequestAction({ id: group.id, name: String(data.get("name") ?? "") }));
    }
  }

  const since = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(group.since));

  return (
    <li className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <p className="title-3 break-words">
          {group.name} <span className="body-6 text-ink-soft">({t(`kind.${group.kind}`)})</span>
        </p>
        <p className="body-6 text-ink-soft break-words">
          {t("board.askedBy", { cooperatives: group.cooperativeNames.join(", "), date: since })}
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {declining ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`reason-${group.id}`} className="title-4">
              {t("board.reason")}
            </label>
            <input
              id={`reason-${group.id}`}
              name="reason"
              required
              minLength={3}
              maxLength={300}
              className={inputClass}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor={`name-${group.id}`} className="title-4">
              {t("board.name")}
            </label>
            <input
              id={`name-${group.id}`}
              name="name"
              required
              maxLength={60}
              defaultValue={group.name}
              className={inputClass}
            />
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="submit" disabled={busy} className={`${buttonClass("ink")} w-full`}>
            {declining ? t("board.confirmDecline") : t("board.approve")}
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass("paper")} w-full`}
            onClick={() => setDeclining(!declining)}
          >
            {declining ? t("board.cancel") : t("board.decline")}
          </button>
        </div>
      </form>
      <FormError message={error} />
    </li>
  );
}

// Forwarded requests, one row per kind and name. Approving adds the item and answers every
// cooperative that asked for it.
export function RequestsPanel({ groups }: { groups: BoardCatalogRequestGroup[] }) {
  const t = useTranslations("catalogRequests");
  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">{t("board.heading")}</h2>
      {groups.length === 0 ? (
        <p className="body-3 text-ink-soft">{t("board.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </ul>
      )}
    </section>
  );
}
