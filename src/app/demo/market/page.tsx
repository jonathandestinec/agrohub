import type { Metadata } from "next";
import { PageHeading } from "../_components/ui";
import { MarketBrowser } from "./market-browser";

export const metadata: Metadata = { title: "Market" };

export default function MarketPage() {
  return (
    <div className="px-2 pt-8 md:px-6 md:pt-12">
      <PageHeading
        title="Harvests for sale"
        lead="Every lot comes from a verified cooperative and was approved by its officer. You pay the cooperative once, and the payment is held until you confirm delivery."
      />
      <MarketBrowser />
    </div>
  );
}
