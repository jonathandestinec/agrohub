import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonClass, Card, PageHeading } from "@/components/ui";
import { formatNaira, formatNairaChange } from "@/lib/money";
import { listPublicBoard, type PublicBoardRow } from "@/modules/board/service";
import { listActiveCatalog } from "@/modules/catalog/service";

// Public: farmers, buyers and signed-out visitors read the board. The crop filter is a
// plain GET form, so it works without JavaScript.
export default function PricesPage({
  searchParams,
}: {
  searchParams: Promise<{ crop?: string | string[] }>;
}) {
  return (
    <Suspense fallback={null}>
      <Prices searchParams={searchParams} />
    </Suspense>
  );
}

async function Prices({
  searchParams,
}: {
  searchParams: Promise<{ crop?: string | string[] }>;
}) {
  const t = await getTranslations("prices");
  const locale = await getLocale();
  const { crop } = await searchParams;
  const cropId = typeof crop === "string" && crop !== "" ? crop : undefined;
  const [{ crops }, rows] = await Promise.all([
    listActiveCatalog(),
    listPublicBoard({ cropId }),
  ]);
  const formatWeek = (iso: string) =>
    t("weekOf", {
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`),
      ),
    });
  const change = (row: PublicBoardRow) => {
    if (row.previousKobo === null) return t("noEarlier");
    if (row.previousKobo === row.priceKobo) return t("noChange");
    return formatNairaChange(row.previousKobo, row.priceKobo);
  };

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      {crops.length > 0 ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-xs">
            <label htmlFor="crop" className="title-4">
              {t("filterLabel")}
            </label>
            <select
              id="crop"
              name="crop"
              defaultValue={cropId ?? ""}
              className="min-h-12 w-full rounded-input bg-paper px-4 body-3 text-ink"
            >
              <option value="">{t("allCrops")}</option>
              {crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("ink", "lg")}>
            {t("filter")}
          </button>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="body-3 text-ink-soft">{cropId ? t("emptyCrop") : t("empty")}</p>
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {rows.map((row) => (
              <li key={`${row.crop}|${row.unit}|${row.market}`}>
                <Card tone="paper" className="flex flex-col gap-1">
                  <span className="title-2 break-words">{row.crop}</span>
                  <span className="body-6 text-ink-soft break-words">{row.market}</span>
                  <span className="mt-2 heading-6">
                    {formatNaira(row.priceKobo)}{" "}
                    <span className="body-6 text-ink-soft">{t("perUnit", { unit: row.unit })}</span>
                  </span>
                  <span className="body-6 text-ink-soft">
                    {formatWeek(row.weekOf)} · {change(row)}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-inner bg-paper md:block">
            <table className="w-full text-left body-3">
              <thead className="title-4 text-ink-soft">
                <tr>
                  <th scope="col" className="p-4">{t("crop")}</th>
                  <th scope="col" className="p-4">{t("unit")}</th>
                  <th scope="col" className="p-4">{t("market")}</th>
                  <th scope="col" className="p-4">{t("week")}</th>
                  <th scope="col" className="p-4 text-right">{t("price")}</th>
                  <th scope="col" className="p-4 text-right">{t("change")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.crop}|${row.unit}|${row.market}`} className="even:bg-step">
                    <th scope="row" className="p-4 title-4">{row.crop}</th>
                    <td className="p-4">{row.unit}</td>
                    <td className="p-4 break-words">{row.market}</td>
                    <td className="p-4">{formatWeek(row.weekOf)}</td>
                    <td className="p-4 text-right tabular-nums">{formatNaira(row.priceKobo)}</td>
                    <td className="p-4 text-right tabular-nums text-ink-soft">{change(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
