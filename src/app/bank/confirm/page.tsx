import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { ConfirmForm } from "./confirm-form";

// Opened from the confirmation email, possibly signed out. Confirming is a button press,
// never a page load, so link scanners and prefetching cannot confirm a change.
export default function BankConfirmPage({ searchParams }: PageProps<"/bank/confirm">) {
  return (
    <Suspense fallback={null}>
      <ConfirmStep searchParams={searchParams} />
    </Suspense>
  );
}

async function ConfirmStep({
  searchParams,
}: {
  searchParams: PageProps<"/bank/confirm">["searchParams"];
}) {
  const { token } = await searchParams;
  const t = await getTranslations("bank.confirm");
  return (
    <AuthCard title={t("title")}>
      {typeof token === "string" && token.length > 0 ? (
        <>
          <p className="text-base text-muted">{t("body")}</p>
          <ConfirmForm token={token} />
        </>
      ) : (
        <p role="alert" className="text-base">
          {t("invalid")}
        </p>
      )}
    </AuthCard>
  );
}
