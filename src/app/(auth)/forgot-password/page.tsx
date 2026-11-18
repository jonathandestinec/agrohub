import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-ui";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  const app = await getTranslations("app");
  return (
    <AuthCard title={t("title")} lead={t("lead")} photo="harvest" caption={app("tagline")}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
