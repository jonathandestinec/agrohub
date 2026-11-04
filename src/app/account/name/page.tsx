import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Card, PageHeading } from "@/components/ui";
import { withNext } from "@/lib/safe-next";
import { currentUser } from "@/modules/identity/session";
import { PERSON_DOCUMENT_KINDS } from "@/modules/name-changes/schema";
import { getOwnNameState } from "@/modules/name-changes/service";
import { requestOwnNameChangeAction, withdrawOwnNameChangeAction } from "./actions";
import { NameChangePanel } from "./name-change-form";

// Any signed-in person, with or without an active membership (a PENDING farmer included),
// asks for a change to their own name here.
export default function AccountNamePage() {
  return (
    <Suspense fallback={null}>
      <AccountName />
    </Suspense>
  );
}

async function AccountName() {
  const user = await currentUser();
  if (!user) redirect(withNext("/sign-in", "/account/name"));
  const t = await getTranslations("nameChange");
  const { name, request } = await getOwnNameState(user);

  return (
    <main id="main" className="flex flex-1 flex-col gap-6 rounded-panel bg-step p-4 md:p-8">
      <PageHeading title={t("title")} lead={t("lead")} />
      <div className="grid gap-2 md:grid-cols-12">
        <Card tone="paper" className="md:col-span-4">
          <dl className="flex flex-col gap-1">
            <dt className="body-6 text-ink-soft">{t("currentName")}</dt>
            <dd className="title-2 break-words">{name}</dd>
          </dl>
        </Card>
        <Card tone="paper" className="md:col-span-8">
          <NameChangePanel
            request={request}
            kinds={[...PERSON_DOCUMENT_KINDS]}
            submit={requestOwnNameChangeAction}
            withdraw={withdrawOwnNameChangeAction}
          />
        </Card>
      </div>
    </main>
  );
}
