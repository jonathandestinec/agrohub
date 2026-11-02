import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { safeNext } from "@/lib/safe-next";
import { SignUpForm } from "./sign-up-form";

// ?next= is URL data, so it is read inside a Suspense boundary (cacheComponents).
export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <Suspense fallback={null}>
      <SignUpCard searchParams={searchParams} />
    </Suspense>
  );
}

async function SignUpCard({
  searchParams,
}: {
  searchParams: PageProps<"/sign-up">["searchParams"];
}) {
  const { next } = await searchParams;
  const t = await getTranslations("auth.signUp");
  return (
    <AuthCard title={t("title")}>
      <SignUpForm next={safeNext(next)} />
    </AuthCard>
  );
}
