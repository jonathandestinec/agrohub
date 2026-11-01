import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const t = await getTranslations("auth.signUp");
  return (
    <AuthCard title={t("title")}>
      <SignUpForm />
    </AuthCard>
  );
}
