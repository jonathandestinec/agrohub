"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Field, FormError, SubmitButton } from "@/components/auth-ui";
import { uploadDocumentAction } from "../actions";
import { errorKey } from "./error-key";

type Kind = "REGISTRATION_CERTIFICATE" | "BYLAWS" | "OFFICER_LIST";

function UploadRow({ kind, done }: { kind: Kind; done: boolean }) {
  const t = useTranslations("officer.onboarding");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    const result = await uploadDocumentAction(new FormData(form));
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6 [&_input]:bg-paper [&_select]:bg-paper"
    >
      <input type="hidden" name="kind" value={kind} />
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`file-${kind}`} className="title-3">
          {t(`kinds.${kind}`)}
        </label>
        {done ? (
          <span className="title-4 underline underline-offset-2">{t("uploaded")}</span>
        ) : null}
      </div>
      <input
        id={`file-${kind}`}
        name="file"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        required
        className="min-h-12 w-full rounded-input bg-paper px-2 py-2 body-3 text-ink file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-full file:border-0 file:bg-step file:px-4 file:title-4 file:text-ink"
      />
      {kind === "REGISTRATION_CERTIFICATE" ? (
        // Each upload is a renewal: the new certificate brings its own expiry date.
        <Field
          id={`certificateExpiresAt-${kind}`}
          name="certificateExpiresAt"
          type="date"
          label={t("fields.certificateExpiresAt")}
          hint={t("certificateExpiryHint")}
          required
        />
      ) : null}
      <FormError message={error} />
      <SubmitButton
        pending={pending}
        label={done ? t("replace") : t("upload")}
        pendingLabel={t("uploading")}
      />
    </form>
  );
}

export function DocumentUploads({
  kinds,
  uploaded,
}: {
  kinds: Kind[];
  uploaded: Kind[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {kinds.map((kind) => (
        <UploadRow key={kind} kind={kind} done={uploaded.includes(kind)} />
      ))}
    </div>
  );
}
