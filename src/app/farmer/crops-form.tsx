"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton } from "@/components/auth-ui";
import { CropPicker } from "@/components/crop-picker";
import { updateCropsAction } from "./actions";
import { errorKey } from "./error-key";

// An active farmer changes the crops on their profile, from the board's list.
export function CropsForm({
  crops,
  chosen,
}: {
  crops: { id: string; name: string }[];
  chosen: string[];
}) {
  const t = useTranslations("farmer");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateCropsAction(new FormData(event.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <details className="rounded-inner bg-step p-4 md:p-6 [&_label]:bg-paper">
      <summary className="flex min-h-11 cursor-pointer items-center title-3">
        {t("home.editCrops")}
      </summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
        <CropPicker crops={crops} chosen={chosen} />
        <FormError message={error} />
        {saved ? (
          <p role="status" className="body-6 text-ink-soft">
            {t("home.cropsSaved")}
          </p>
        ) : null}
        <SubmitButton pending={pending} label={t("home.saveCrops")} pendingLabel={t("home.savingCrops")} />
      </form>
    </details>
  );
}
