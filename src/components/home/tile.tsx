import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowUpRight, ButtonLink, Card, Chip } from "@/components/ui";
import { countLabel, type TileItem } from "@/lib/summary";
import type { Tile as HomeTile } from "@/modules/home/service";

// A date-only value (YYYY-MM-DD) is a Lagos calendar day; a date-time is shown in Lagos time.
function dayFormatter(locale: string) {
  const options = { dateStyle: "medium" } as const;
  const dateTime = new Intl.DateTimeFormat(locale, { ...options, timeZone: "Africa/Lagos" });
  const dateOnly = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  return (value: string) =>
    value.length === 10 ? dateOnly.format(new Date(`${value}T00:00:00Z`)) : dateTime.format(new Date(value));
}

// One to-do or history tile: a title, a count (to-do tiles), up to three items that open the item,
// an empty line when there are none, and "See all". Words come from the message files; an item's
// label is a full message key, so a status code is never printed. Long names wrap.
export async function Tile({ tile }: { tile: HomeTile }) {
  const t = await getTranslations("home");
  const words = await getTranslations();
  const locale = await getLocale();
  const day = dayFormatter(locale);
  const titleId = `tile-${tile.id}`;

  let items: TileItem[] = [];
  let count: number | null = null;
  if (tile.status === "ok" && tile.kind === "todo") {
    items = tile.summary.items;
    count = tile.summary.count;
  } else if (tile.status === "ok" && tile.kind === "history") {
    items = tile.history.items;
  }

  const dateKey = `dates.${tile.id}` as Parameters<typeof t>[0];
  const hasDateCopy = tile.id in DATE_COPY;

  return (
    <Card tone="paper" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3" role="group" aria-labelledby={titleId}>
        <h2 id={titleId} className="title-2 min-w-0 break-words">
          {t(`tiles.${tile.id}`)}
        </h2>
        {count !== null ? (
          <span
            className="min-w-12 shrink-0 rounded-full bg-step px-3 py-1 text-center heading-6 tabular-nums"
            aria-label={String(count)}
          >
            {countLabel(count)}
          </span>
        ) : null}
      </div>

      {tile.status === "error" ? (
        <p role="status" className="body-3 text-ink-soft">
          {t("error")}
        </p>
      ) : tile.kind === "counts" ? (
        <dl className="grid grid-cols-3 gap-2">
          {(["pendingReview", "live", "soldOut"] as const).map((key) => (
            <div key={key} className="flex min-w-0 flex-col gap-1 rounded-inner bg-step p-3">
              <dd className="heading-5 tabular-nums">{countLabel(tile.counts[key])}</dd>
              <dt className="body-6 break-words text-ink-soft">{t(`counts.${key}`)}</dt>
            </div>
          ))}
        </dl>
      ) : items.length === 0 ? (
        <p className="body-3 text-ink-soft">{t(`empty.${tile.id}`)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <Link
                href={item.href}
                className="press press-lift flex min-h-11 min-w-0 flex-col gap-1 rounded-inner bg-step p-3 hover:bg-step-deep"
              >
                <span className="body-1 break-words">{item.title}</span>
                {item.detail ? <span className="body-6 break-words text-ink-soft">{item.detail}</span> : null}
                {item.date ? (
                  <span className="body-6 text-ink-soft">
                    {hasDateCopy ? t(dateKey, { date: day(item.date) }) : day(item.date)}
                  </span>
                ) : null}
                {item.label ? (
                  <span className="mt-1 flex">
                    <Chip tone="paper">{words(item.label as Parameters<typeof words>[0])}</Chip>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ButtonLink href={tile.seeAll} tone="step" className="mt-auto self-start">
        {t("seeAll")}
        <ArrowUpRight />
      </ButtonLink>
    </Card>
  );
}

// The tiles whose items show a date with a lead-in word ("Pay by …", "Delivery …").
const DATE_COPY: Record<string, true> = {
  farmerOffers: true,
  farmerEarnings: true,
  officerFarmers: true,
  officerOffers: true,
  officerPrepare: true,
  officerAttention: true,
  officerRequests: true,
  buyerOffers: true,
  buyerOrders: true,
  adminCooperatives: true,
  adminDisputes: true,
  adminPayouts: true,
  adminReconciliation: true,
  adminNames: true,
  messages: true,
};
