import { useTranslations } from "next-intl";
import { formatNaira, formatPercent, saleBreakdown } from "@/lib/money";

// What a sale of the whole lot at the asking price is worth to the farmer (spec 6.3): the
// cooperative's cut and AgroHub's fee come out of the price, not on top. Server or client.
export function Breakdown({
  askKobo,
  quantity,
  cutBps,
  feeBps,
  unit,
}: {
  askKobo: number;
  quantity: number;
  cutBps: number;
  feeBps: number;
  unit: string;
}) {
  const t = useTranslations("lots.breakdown");
  const b = saleBreakdown(askKobo, quantity, cutBps, feeBps);
  const rows: Array<[string, string]> = [
    [t("sale", { quantity, unit }), formatNaira(b.grossKobo)],
    [t("cut", { percent: formatPercent(cutBps) }), `-${formatNaira(b.cooperativeKobo)}`],
    [t("fee", { percent: formatPercent(feeBps) }), `-${formatNaira(b.feeKobo)}`],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-inner bg-paper p-4 body-3">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-soft">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
      <dt className="title-4">{t("perUnit", { unit })}</dt>
      <dd className="title-4 text-right tabular-nums">{formatNaira(b.takeHomePerUnitKobo)}</dd>
      <dt className="title-3">{t("total")}</dt>
      <dd className="title-3 text-right tabular-nums">{formatNaira(b.takeHomeKobo)}</dd>
    </dl>
  );
}
