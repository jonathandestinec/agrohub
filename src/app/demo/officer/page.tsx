import type { Metadata } from "next";
import { Chip, PageHeading } from "../_components/ui";
import { cooperativeById } from "../_lib/data";
import { OfficerDesk } from "./officer-desk";

export const metadata: Metadata = { title: "Officer" };

export default function OfficerPage() {
  const coop = cooperativeById("ogbomoso");
  return (
    <div className="px-2 pt-8 md:px-6 md:pt-12">
      <PageHeading title={coop.name} lead={`Officer desk for Tunde Adeleke · ${coop.members} members · ${coop.lga}, ${coop.state}`}>
        <Chip tone="forest">Verified until Oct 2027</Chip>
      </PageHeading>
      <OfficerDesk />
    </div>
  );
}
