import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { buttonClass } from "@/components/ui/button";
import { ResetPasswordForm } from "./reset-password-form";

// Better Auth redirects here from the emailed link with ?token=<token>, or ?error=INVALID_TOKEN
// when the token is unknown or expired. searchParams is URL data, read inside Suspense.
export default function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  return (
    <Suspense fallback={null}>
      <ResetPasswordCard searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetPasswordCard({
  searchParams,
}: {
  searchParams: PageProps<"/reset-password">["searchParams"];
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations("auth.reset");
  const app = await getTranslations("app");
  const validToken = typeof token === "string" && token.length > 0 && error === undefined ? token : null;
  if (!validToken) {
    return (
      <AuthCard title={t("invalidTitle")}>
        <p className="text-ink-soft">{t("invalidBody")}</p>
        <Link href="/forgot-password" className={`${buttonClass("ink")} w-full`}>
          {t("requestNew")}
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("title")} lead={t("lead")} photo="harvest" caption={app("tagline")}>
      <ResetPasswordForm token={validToken} />
    </AuthCard>
  );
}
