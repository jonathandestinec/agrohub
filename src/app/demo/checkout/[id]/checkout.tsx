"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatNaira } from "@/lib/money";
import { demoBreakdown } from "../../_lib/breakdown";
import { AGROHUB_FEE_BPS, COOP_CUT_BPS } from "../../_lib/data";
import { Button, ButtonLink, Check } from "../../_components/ui";

type Stage = "review" | "paying" | "held" | "delivered" | "released";

const TIMELINE: { key: Stage; title: string; body: string }[] = [
  { key: "held", title: "Payment held", body: "Paystack confirmed your payment. AgroHub holds it; the cooperative cannot touch it." },
  { key: "delivered", title: "Cooperative delivers", body: "The officer arranges delivery or pickup and marks the order delivered." },
  { key: "released", title: "You confirm, farmers are paid", body: "Your confirmation releases the payment to the cooperative and each farmer." },
];
const ORDER: Stage[] = ["review", "paying", "held", "delivered", "released"];

export function Checkout({
  lotId,
  cropName,
  unit,
  askKobo,
  minOrder,
  available,
  cooperative,
  farmers,
}: {
  lotId: string;
  cropName: string;
  unit: string;
  askKobo: number;
  minOrder: number;
  available: number;
  cooperative: string;
  farmers: number;
}) {
  const params = useSearchParams();
  const requested = Number(params.get("qty"));
  const qty = Number.isSafeInteger(requested) && requested >= minOrder && requested <= available ? requested : minOrder;
  const total = askKobo * qty;
  const split = demoBreakdown(askKobo, qty, COOP_CUT_BPS, AGROHUB_FEE_BPS);
  const [stage, setStage] = useState<Stage>("review");
  const [seconds, setSeconds] = useState(15 * 60);

  useEffect(() => {
    if (stage !== "review") return;
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  useEffect(() => {
    if (stage !== "paying") return;
    const t = setTimeout(() => setStage("held"), 1400);
    return () => clearTimeout(t);
  }, [stage]);

  const reached = (s: Stage) => ORDER.indexOf(stage) >= ORDER.indexOf(s);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="mt-6 grid gap-3 lg:grid-cols-12">
      <section aria-labelledby="summary" className="flex flex-col gap-4 rounded-3xl bg-[var(--d-step)] p-6 md:p-8 lg:col-span-5">
        <h2 id="summary" className="heading-6">Order summary</h2>
        <dl className="flex flex-col gap-3 body-3">
          <Line k={`${cropName}, ${qty} ${unit}s`} v={formatNaira(total)} />
          <Line k="Seller" v={cooperative} />
          <Line k="Lot" v={lotId} />
        </dl>
        <div className="flex items-baseline justify-between rounded-2xl bg-[var(--d-paper)] px-4 py-3">
          <span className="body-5">You pay</span>
          <span className="heading-5">{formatNaira(total)}</span>
        </div>
        {stage === "review" ? (
          <p className="caption-2 text-[var(--d-ink-2)]">
            These {qty} {unit}s are reserved for you for <span className="title-4 text-[var(--d-ink)]">{mm}:{ss}</span>.
          </p>
        ) : null}
        <details className="rounded-2xl bg-[var(--d-paper)] px-4">
          <summary className="flex min-h-11 cursor-pointer items-center title-4">Where your money goes</summary>
          <dl className="flex flex-col gap-2 pb-4 body-6">
            <Line k={`${farmers} farmers`} v={formatNaira(split.takeHomeKobo)} />
            <Line k="Cooperative" v={formatNaira(split.cooperativeKobo)} />
            <Line k="AgroHub" v={formatNaira(split.feeKobo)} />
          </dl>
        </details>
      </section>

      <section aria-labelledby="pay" className="flex flex-col gap-6 rounded-3xl bg-[var(--d-paper)] p-2 lg:col-span-7">
        <div className="rounded-[20px] bg-[var(--d-lime)] p-6 text-[var(--d-lime-ink)] md:p-8">
          <h2 id="pay" className="heading-4">
            {stage === "released" ? "Order complete" : stage === "review" || stage === "paying" ? "Pay once, safely" : "Payment held until delivery"}
          </h2>
          <p className="mt-3 max-w-[52ch] body-3">
            {stage === "released"
              ? `${formatNaira(total)} has been released: ${farmers} farmers and the cooperative are being paid by bank transfer.`
              : "You pay the full amount now. AgroHub holds it and only pays the cooperative and farmers after you confirm delivery."}
          </p>
          <div className="mt-6" aria-live="polite">
            {stage === "review" ? (
              <Button className="min-h-12" onClick={() => setStage("paying")}>Pay {formatNaira(total)} with Paystack</Button>
            ) : null}
            {stage === "paying" ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Waiting for Paystack">
                <div className="h-12 w-72 animate-pulse rounded-full bg-[var(--d-lime-ink)]/15" />
                <div className="h-4 w-48 animate-pulse rounded-full bg-[var(--d-lime-ink)]/10" />
              </div>
            ) : null}
            {stage === "held" ? (
              <Button tone="paper" className="min-h-12" onClick={() => setStage("delivered")}>Officer marks delivered (demo step)</Button>
            ) : null}
            {stage === "delivered" ? (
              <Button className="min-h-12" onClick={() => setStage("released")}>Confirm I received it</Button>
            ) : null}
            {stage === "released" ? (
              <ButtonLink href="/demo/market" tone="paper" className="min-h-12">Back to the market</ButtonLink>
            ) : null}
          </div>
        </div>

        <ol className="flex flex-col gap-2 px-4 pb-4 md:px-6">
          {TIMELINE.map((t) => {
            const done = reached(t.key);
            return (
              <li key={t.key} className={`flex gap-4 rounded-2xl p-4 transition-colors duration-300 ${done ? "bg-[var(--d-step)]" : ""}`}>
                <span
                  className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
                    done ? "bg-[var(--d-forest)] text-[var(--d-forest-ink)]" : "bg-[var(--d-step)] text-[var(--d-ink-2)]"
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check /> : <span className="size-2 rounded-full bg-current" />}
                </span>
                <div>
                  <h3 className="title-3">
                    {t.title}
                    <span className="sr-only">{done ? ", done" : ", not yet"}</span>
                  </h3>
                  <p className="mt-1 body-6 text-[var(--d-ink-2)]">{t.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[var(--d-ink-2)]">{k}</dt>
      <dd className="text-right title-3">{v}</dd>
    </div>
  );
}
