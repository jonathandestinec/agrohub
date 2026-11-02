import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { safeNext } from "@/lib/safe-next";
import { SignInForm } from "./sign-in-form";

// ?next= is URL data, so it is read inside a Suspense boundary (cacheComponents).
export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <Suspense fallback={null}>
      <SignInCard searchParams={searchParams} />
    </Suspense>
  );
}

async function SignInCard({
  searchParams,
}: {
  searchParams: PageProps<"/sign-in">["searchParams"];
}) {
  const { next } = await searchParams;
  const t = await getTranslations("auth.signIn");
  const app = await getTranslations("app");
  return (
    <AuthCard title={t("title")} photo="harvest" caption={app("tagline")}>
      <SignInForm next={safeNext(next)} />
    </AuthCard>
  );
}
