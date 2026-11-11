import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink, Card } from "@/components/ui";
import type { DeliveryRow, DeliverySchedule } from "@/modules/orders/service";

function Row({ row }: { row: DeliveryRow }) {
  return (
    <li className="min-w-0">
      <Link
        href={row.href}
        className="press press-lift flex min-h-11 min-w-0 flex-col gap-1 rounded-inner bg-step p-3 hover:bg-step-deep"
      >
        <span className="body-1 break-words">{row.title}</span>
        {row.detail ? <span className="body-6 break-words text-ink-soft">{row.detail}</span> : null}
      </Link>
    </li>
  );
}

// The officer's upcoming deliveries: overdue first, then each of the next 14 days with orders,
// then two lines that count the orders with no date and those later than two weeks.
export async function Schedule({ schedule }: { schedule: DeliverySchedule | null }) {
  const t = await getTranslations("home.schedule");
  const locale = await getLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  const dayOf = (key: string) => day.format(new Date(`${key}T00:00:00Z`));

  if (schedule === null) {
    return (
      <Card tone="paper" className="flex flex-col gap-4">
        <h2 className="title-2">{t("title")}</h2>
        <p role="status" className="body-3 text-ink-soft">
          {t("error")}
        </p>
      </Card>
    );
  }

  const shown = schedule.overdue.length + schedule.days.reduce((n, d) => n + d.orders.length, 0);
  return (
    <Card tone="paper" className="flex min-w-0 flex-col gap-4">
      <h2 className="title-2">{t("title")}</h2>
      {shown === 0 ? (
        <p className="body-3 text-ink-soft">{t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {schedule.overdue.length > 0 ? (
            <section aria-labelledby="schedule-overdue" className="flex flex-col gap-2">
              <h3 id="schedule-overdue" className="body-1 text-warn">
                {t("overdue")}
              </h3>
              <ul className="grid gap-2 md:grid-cols-2">
                {schedule.overdue.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ) : null}
          {schedule.days.map((group) => (
            <section key={group.date} aria-label={dayOf(group.date)} className="flex flex-col gap-2">
              <h3 className="body-1">{dayOf(group.date)}</h3>
              <ul className="grid gap-2 md:grid-cols-2">
                {group.orders.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            </section>
          ))}
          {schedule.more > 0 ? <p className="body-6 text-ink-soft">{t("more", { count: schedule.more })}</p> : null}
        </div>
      )}
      {schedule.noDate > 0 || schedule.later > 0 ? (
        <ul className="flex flex-col gap-1">
          {schedule.noDate > 0 ? (
            <li>
              <Link href="/officer/orders" className="inline-flex min-h-11 items-center body-5 underline underline-offset-4">
                {t("noDate", { count: schedule.noDate })}
              </Link>
            </li>
          ) : null}
          {schedule.later > 0 ? (
            <li>
              <Link href="/officer/orders" className="inline-flex min-h-11 items-center body-5 underline underline-offset-4">
                {t("later", { count: schedule.later })}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
      <ButtonLink href="/officer/orders" tone="step" className="self-start">
        {t("seeAll")}
      </ButtonLink>
    </Card>
  );
}
