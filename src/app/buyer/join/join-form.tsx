"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import { becomeBuyerAction } from "../actions";

export function JoinForm() {
  const t = useTranslations("buyer.join");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    const result = await becomeBuyerAction();
    if (!result.ok) {
      setPending(false);
      setError(t(result.code === "EMAIL_NOT_VERIFIED" ? "emailNotVerified" : "error"));
      return;
    }
    router.push("/buyer");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      <Button tone="ink" size="lg" onClick={start} disabled={pending}>
        {t("start")}
      </Button>
    </div>
  );
}
