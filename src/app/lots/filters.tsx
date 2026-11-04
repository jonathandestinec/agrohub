import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui";
import { nairaInput } from "@/lib/money";
import { LOT_SORTS, type LotFilters } from "@/modules/catalog/service";
import { STATES } from "@/modules/geo/states";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";
const GRADES = ["A", "B", "C", "UNGRADED"] as const;

// A plain GET form, so filtering works without JavaScript and every result has a shareable URL.
export async function LotFiltersForm({
  filters,
  crops,
}: {
  filters: LotFilters;
  crops: { id: string; name: string }[];
}) {
  const t = await getTranslations("publicLots.filters");
  const tl = await getTranslations("lots");
  return (
    <form method="get" action="/lots" className="grid gap-3 rounded-inner bg-paper/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 body-6">
        {t("crop")}
        <select name="cropId" defaultValue={filters.cropId ?? ""} className={FIELD}>
          <option value="">{t("any")}</option>
          {crops.map((crop) => (
            <option key={crop.id} value={crop.id}>
              {crop.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("state")}
        <select name="state" defaultValue={filters.state ?? ""} className={FIELD}>
          <option value="">{t("any")}</option>
          {STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("grade")}
        <select name="grade" defaultValue={filters.grade ?? ""} className={FIELD}>
          <option value="">{t("any")}</option>
          {GRADES.map((grade) => (
            <option key={grade} value={grade}>
              {tl(`grade.${grade}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("sort")}
        <select name="sort" defaultValue={filters.sort} className={FIELD}>
          {LOT_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`sorts.${sort}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("minPrice")}
        <input
          name="minPrice"
          inputMode="decimal"
          defaultValue={filters.minPriceKobo !== undefined ? nairaInput(filters.minPriceKobo) : ""}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("maxPrice")}
        <input
          name="maxPrice"
          inputMode="decimal"
          defaultValue={filters.maxPriceKobo !== undefined ? nairaInput(filters.maxPriceKobo) : ""}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1 body-6">
        {t("minQuantity")}
        <input name="minQuantity" inputMode="numeric" defaultValue={filters.minQuantity ?? ""} className={FIELD} />
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className={buttonClass("ink")}>
          {t("apply")}
        </button>
        <Link href="/lots" className={buttonClass("paper")}>
          {t("clear")}
        </Link>
      </div>
    </form>
  );
}
