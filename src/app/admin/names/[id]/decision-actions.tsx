"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError, SubmitButton } from "@/components/auth-ui";
import { approveNameChangeAction, rejectNameChangeAction } from "../../actions";

const KNOWN_ERRORS = [
  "NAME_CHANGE_NOT_PENDING",
  "CANNOT_DECIDE_OWN_NAME_CHANGE",
  "REASON_REQUIRED",
  "REASON_TOO_LONG",
  "NAME_CHANGE_NOT_FOUND",
  "UNAUTHENTICATED",
  "FORBIDDEN",
] as const;

function errorKey(code: string): `errors.${(typeof KNOWN_ERRORS)[number] | "INTERNAL"}` {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}

// Offered only when the admin may decide; the service enforces the same rule.
export function DecisionActions({ requestId }: { requestId: string }) {
  const t = useTranslations("admin.names");
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(kind: "approve" | "reject", reason?: string) {
    setPending(kind);
    setError(null);
    const result =
      kind === "approve"
        ? await approveNameChangeAction({ requestId })
        : await rejectNameChangeAction({ requestId, reason });
    setPending(null);
    if (!result.ok) {
      setError(t(errorKey(result.code)));
      return;
    }
    router.refresh();
  }

  function onReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    void decide("reject", typeof reason === "string" ? reason : "");
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void decide("approve");
        }}
        className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6"
      >
        <SubmitButton
          pending={pending === "approve"}
          label={t("detail.approve")}
          pendingLabel={t("detail.working")}
        />
      </form>
      <form onSubmit={onReject} className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="reject-reason" className="title-4">
            {t("detail.rejectReason")}
          </label>
          <textarea
            id="reject-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            className="w-full rounded-input bg-paper px-4 py-3 body-3 text-ink"
          />
        </div>
        <SubmitButton
          pending={pending === "reject"}
          label={t("detail.reject")}
          pendingLabel={t("detail.working")}
        />
      </form>
    </div>
  );
}
