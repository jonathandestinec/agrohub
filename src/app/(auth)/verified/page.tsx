import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { safeNext, withNext } from "@/lib/safe-next";

// Better Auth redirects here after /api/auth/verify-email, adding ?error=<CODE> on failure.
// ?next= is the page sign-up started from; it is URL data, so it is checked again here.
// searchParams is URL data, so it is read inside a Suspense boundary (cacheComponents).
export default function VerifiedPage({ searchParams }: PageProps<"/verified">) {
  return (
    <Suspense fallback={null}>
      <VerifiedResult searchParams={searchParams} />
    </Suspense>
  );
}

async function VerifiedResult({
  searchParams,
}: {
  searchParams: PageProps<"/verified">["searchParams"];
}) {
  const { error, next } = await searchParams;
  const returnTo = safeNext(next);
  const t = await getTranslations("auth.verified");
  const failed = error !== undefined;
  return (
    <AuthCard title={failed ? t("failedTitle") : t("title")}>
      <p className="text-muted">{failed ? t("failedBody") : t("body")}</p>
      <Link
        href={withNext("/sign-in", returnTo)}
        className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-semibold text-primary-fg"
      >
        {t("signIn")}
      </Link>
    </AuthCard>
  );
}
