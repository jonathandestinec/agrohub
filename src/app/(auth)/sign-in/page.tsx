import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const t = await getTranslations("auth.signIn");
  return (
    <AuthCard title={t("title")}>
      <SignInForm />
    </AuthCard>
  );
}
