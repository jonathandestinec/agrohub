"use client";

import { useTranslations } from "next-intl";
import { openAlertAction } from "@/app/alerts/actions";
import type { AlertView } from "@/modules/notifications/views";

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Africa/Lagos" });

// Alerts as rows. Each is a form with one button, so opening one works without script: it marks
// the alert read, then goes to the page it is about.
export function AlertList({ alerts, itemClassName = "" }: { alerts: AlertView[]; itemClassName?: string }) {
  const t = useTranslations("alerts");
  return (
    <ul className="flex flex-col gap-1">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <form action={openAlertAction}>
            <input type="hidden" name="id" value={alert.id} />
            <button
              type="submit"
              className={`press flex min-h-11 w-full items-start gap-3 rounded-tile px-3 py-2 text-left hover:bg-step ${itemClassName}`}
            >
              {alert.read ? (
                <span aria-hidden="true" className="mt-2 size-2 shrink-0" />
              ) : (
                <>
                  <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-lime" />
                  <span className="sr-only">{t("unread")}</span>
                </>
              )}
              <span className="flex min-w-0 flex-col">
                <span className={`body-6 ${alert.read ? "text-ink-soft" : "title-4"}`}>
                  {alert.malformed ? t("fallback") : t(`kind.${alert.kind}`, alert.params)}
                </span>
                <span className="caption-4 text-ink-soft">{DAY.format(new Date(alert.createdAt))}</span>
              </span>
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
