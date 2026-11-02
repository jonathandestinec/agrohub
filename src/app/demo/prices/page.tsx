import type { Metadata } from "next";
import { formatNaira } from "@/lib/money";
import { Chip, CropPhoto, PageHeading } from "../_components/ui";
import { BOARD, BOARD_WEEK, cropById } from "../_lib/data";

export const metadata: Metadata = { title: "Price board" };

export default function PricesPage() {
  return (
    <div className="px-2 pt-8 md:px-6 md:pt-12">
      <PageHeading
        title="Price board"
        lead="Weekly prices posted by AgroHub board admins, per crop and market. Farmers see a gentle warning when their asking price is far from the board."
      >
        <Chip tone="lime">{BOARD_WEEK}</Chip>
      </PageHeading>

      <ul className="mt-10 flex flex-col gap-3">
        {BOARD.map((row) => {
          const crop = cropById(row.cropId);
          return (
            <li key={row.cropId} className="grid gap-2 rounded-3xl bg-[var(--d-step)] p-2 md:grid-cols-[minmax(200px,1fr)_3fr]">
              <CropPhoto crop={crop} sizes="(min-width: 768px) 25vw, 100vw" className="flex min-h-32 flex-col justify-end rounded-[20px] p-5">
                <h2 className="heading-5">{crop.name}</h2>
                <p className="body-6 opacity-90">per {crop.unit}</p>
              </CropPhoto>
              <dl className="grid gap-2 sm:grid-cols-3">
                {row.markets.map((m) => {
                  const change = m.thisWeekKobo - m.lastWeekKobo;
                  return (
                    <div key={m.name} className="flex flex-col justify-between gap-3 rounded-[20px] bg-[var(--d-paper)] p-5">
                      <dt className="body-5 text-[var(--d-ink-2)]">{m.name}</dt>
                      <dd>
                        <span className="block heading-6">{formatNaira(m.thisWeekKobo)}</span>
                        <span className={`mt-1 block caption-4 ${change >= 0 ? "text-[var(--d-good)]" : "text-[var(--d-bad)]"}`}>
                          {change >= 0 ? "Up" : "Down"} {formatNaira(Math.abs(change))} on last week
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
