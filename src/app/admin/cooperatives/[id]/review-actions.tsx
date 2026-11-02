"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton } from "@/components/auth-ui";
import type { ActionResult } from "@/lib/action-result";
import {
  reinstateCooperativeAction,
  rejectCooperativeAction,
  suspendCooperativeAction,
  verifyCooperativeAction,
} from "../../actions";

type Status = "PENDING" | "VERIFIED" | "SUSPENDED";
type Input = { cooperativeId: string; reason?: string };

const KNOWN_ERRORS = [
  "ILLEGAL_TRANSITION",
  "CERTIFICATE_EXPIRED",
  "NOT_SUBMITTED",
  "DOCUMENTS_MISSING",
  "REASON_REQUIRED",
  "REASON_TOO_LONG",
  "VALIDATION_ERROR",
  "COOPERATIVE_NOT_FOUND",
  "UNAUTHENTICATED",
  "FORBIDDEN",
] as const;

function errorKey(
  code: string,
): `errors.${(typeof KNOWN_ERRORS)[number] | "INTERNAL"}` {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}

function ActionForm({
  cooperativeId,
  name,
  label,
  action,
  withReason,
}: {
  cooperativeId: string;
  name: string;
  label: string;
  action: (input: Input) => Promise<ActionResult>;
  withReason: boolean;
}) {
  const t = useTranslations("admin.cooperatives");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    setPending(true);
    setError(null);
    const result = await action({
      cooperativeId,
      ...(withReason && typeof reason === "string" ? { reason } : {}),
    });
    setPending(false);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6"
    >
      {withReason ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`reason-${name}`} className="title-4">
            {t("detail.reason")}
          </label>
          <textarea
            id={`reason-${name}`}
            name="reason"
            required
            maxLength={500}
            rows={3}
            className="w-full rounded-input bg-paper px-4 py-3 body-3 text-ink"
          />
        </div>
      ) : null}
      <FormError message={error} />
      <SubmitButton
        pending={pending}
        label={label}
        pendingLabel={t("actions.working")}
      />
    </form>
  );
}

// Only the actions that make sense for the current status are offered; the service
// enforces the same rules, so this is convenience, not security.
export function ReviewActions({
  cooperativeId,
  status,
}: {
  cooperativeId: string;
  status: Status;
}) {
  const t = useTranslations("admin.cooperatives");
  return (
    <div className="flex flex-col gap-4">
      {status === "PENDING" ? (
        <>
          <ActionForm
            cooperativeId={cooperativeId}
            name="verify"
            label={t("actions.verify")}
            action={verifyCooperativeAction}
            withReason={false}
          />
          <ActionForm
            cooperativeId={cooperativeId}
            name="reject"
            label={t("actions.reject")}
            action={rejectCooperativeAction}
            withReason
          />
        </>
      ) : null}
      {status === "VERIFIED" ? (
        <ActionForm
          cooperativeId={cooperativeId}
          name="suspend"
          label={t("actions.suspend")}
          action={suspendCooperativeAction}
          withReason
        />
      ) : null}
      {status === "SUSPENDED" ? (
        <ActionForm
          cooperativeId={cooperativeId}
          name="reinstate"
          label={t("actions.reinstate")}
          action={reinstateCooperativeAction}
          withReason={false}
        />
      ) : null}
    </div>
  );
}
