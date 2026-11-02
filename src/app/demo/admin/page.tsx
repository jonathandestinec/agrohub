import type { Metadata } from "next";
import { Chip, PageHeading } from "../_components/ui";
import { COOPERATIVES } from "../_lib/data";
import { VerificationQueue } from "./verification-queue";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div className="px-2 pt-8 md:px-6 md:pt-12">
      <PageHeading
        title="Cooperative verification"
        lead="Only verified cooperatives can list or sell. Review each one's registration documents, then verify or send it back with a reason."
      >
        <Chip tone="step">Two-factor sign-in on</Chip>
      </PageHeading>
      <div className="mt-8 grid gap-3 lg:grid-cols-12">
        <VerificationQueue />
        <section aria-labelledby="verified" className="rounded-3xl bg-[var(--d-step)] p-4 md:p-6 lg:col-span-4">
          <h2 id="verified" className="px-2 heading-5">Verified</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {COOPERATIVES.map((c) => (
              <li key={c.id} className="rounded-[20px] bg-[var(--d-paper)] p-4">
                <p className="title-3">{c.name}</p>
                <p className="caption-2 text-[var(--d-ink-2)]">{c.state} · {c.members} members · since {c.verifiedOn}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
