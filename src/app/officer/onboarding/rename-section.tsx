import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui/button";
import { NameChangePanel } from "@/app/account/name/name-change-form";
import type { Actor } from "@/modules/identity/policies";
import { COOPERATIVE_DOCUMENT_KINDS } from "@/modules/name-changes/schema";
import { getCooperativeRename } from "@/modules/name-changes/service";
import { requestCooperativeRenameAction, withdrawCooperativeRenameAction } from "../actions";

// A VERIFIED or SUSPENDED cooperative's name changes only through an admin-approved
// request; a PENDING one is still edited directly in the details form.
export async function RenameSection({
  actor,
  cooperativeId,
}: {
  actor: Actor;
  cooperativeId: string;
}) {
  const t = await getTranslations("nameChange");
  const request = await getCooperativeRename(actor, cooperativeId);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="heading-6">{t("cooperative.heading")}</h2>
      <p className="body-6 text-ink-soft">{t("cooperative.lead")}</p>
      {actor.twoFactorEnabled ? (
        <NameChangePanel
          request={request}
          kinds={[...COOPERATIVE_DOCUMENT_KINDS]}
          submit={requestCooperativeRenameAction}
          withdraw={withdrawCooperativeRenameAction}
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-inner bg-step p-4">
          <p className="body-3">{t("cooperative.needsTwoFactor")}</p>
          <Link href="/two-factor" className={`${buttonClass("ink")} self-start`}>
            {t("cooperative.setUpTwoFactor")}
          </Link>
        </div>
      )}
      <p className="body-6 text-ink-soft">
        <Link href="/account/name" className="underline underline-offset-2">
          {t("cooperative.ownName")}
        </Link>
      </p>
    </section>
  );
}
