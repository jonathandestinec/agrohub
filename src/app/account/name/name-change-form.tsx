"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field, FormError, SubmitButton, inputClass } from "@/components/auth-ui";
import type { NameDocumentKind } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/action-result";
import type { OwnNameChange } from "@/modules/name-changes/views";
import { nameChangeErrorKey } from "./error-key";

type Props = {
  request: OwnNameChange | null;
  kinds: NameDocumentKind[];
  submit: (form: FormData) => Promise<ActionResult<OwnNameChange>>;
  withdraw: (input: { requestId: string }) => Promise<ActionResult<OwnNameChange>>;
};

// Shared by /account/name (a person's own name) and the officer's cooperative page: while a
// request waits it shows that request with Withdraw; otherwise the form and the last outcome.
export function NameChangePanel({ request, kinds, submit, withdraw }: Props) {
  const t = useTranslations("nameChange");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(
      new Date(iso),
    );

  async function run(work: () => Promise<ActionResult<OwnNameChange>>, form?: HTMLFormElement) {
    setPending(true);
    setError(null);
    const result = await work();
    setPending(false);
    if (!result.ok) {
      setError(t(nameChangeErrorKey(result.code)));
      return;
    }
    form?.reset();
    router.refresh();
  }

  if (request?.status === "PENDING") {
    return (
      <section className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6" aria-live="polite">
        <h3 className="title-2">{t("pending.heading")}</h3>
        <p className="body-3">
          {t("pending.body", {
            from: request.fromName,
            to: request.toName,
            date: formatDate(request.createdAt),
          })}
        </p>
        <p className="body-6 text-ink-soft">{t(`kinds.${request.documentKind}`)}</p>
        <FormError message={error} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => withdraw({ requestId: request.id }));
          }}
        >
          <SubmitButton
            pending={pending}
            label={t("pending.withdraw")}
            pendingLabel={t("pending.withdrawing")}
          />
        </form>
      </section>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run(() => submit(new FormData(form)), form);
  }

  return (
    <div className="flex flex-col gap-4">
      {request ? (
        <p role="status" className="rounded-inner bg-step p-4 body-3">
          {request.status === "APPROVED"
            ? t("outcome.APPROVED", { date: formatDate(request.decidedAt ?? request.createdAt), to: request.toName })
            : request.status === "REJECTED"
              ? t("outcome.REJECTED", { reason: request.rejectionReason ?? "" })
              : t("outcome.WITHDRAWN", { to: request.toName })}
        </p>
      ) : null}
      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
        <h3 className="title-2">{t("form.heading")}</h3>
        <Field
          id="newName"
          name="newName"
          label={t("form.newName")}
          hint={t("form.newNameHint")}
          autoComplete="off"
          minLength={2}
          maxLength={120}
          required
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="reason" className="title-4">
            {t("form.reason")}
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            minLength={10}
            maxLength={500}
            required
            aria-describedby="reason-hint"
            className={`${inputClass} py-3`}
          />
          <p id="reason-hint" className="body-6 text-ink-soft">
            {t("form.reasonHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="documentKind" className="title-4">
            {t("form.documentKind")}
          </label>
          <select
            id="documentKind"
            name="documentKind"
            required
            defaultValue={kinds[0]}
            className="min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink"
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="document" className="title-4">
            {t("form.file")}
          </label>
          <input
            id="document"
            name="document"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
            aria-describedby="document-hint"
            className="min-h-12 w-full rounded-input bg-step px-2 py-2 body-3 text-ink file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-full file:border-0 file:bg-paper file:px-4 file:title-4 file:text-ink"
          />
          <p id="document-hint" className="body-6 text-ink-soft">
            {t("form.fileHint")}
          </p>
        </div>
        <FormError message={error} />
        <SubmitButton
          pending={pending}
          label={t("form.submit")}
          pendingLabel={t("form.submitting")}
          waitForHydration
        />
      </form>
    </div>
  );
}
