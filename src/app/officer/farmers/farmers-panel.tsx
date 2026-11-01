"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import type { OfficerFarmerRow } from "@/modules/farmers/service";
import {
  approveFarmerAction,
  rejectFarmerAction,
  removeFarmerAction,
} from "../actions";

const KNOWN_ERRORS = [
  "VALIDATION_ERROR",
  "ILLEGAL_TRANSITION",
  "UNFINISHED_ORDERS",
  "MEMBERSHIP_NOT_FOUND",
  "COOPERATIVE_NOT_VERIFIED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
] as const;

function errorKey(code: string): `errors.${(typeof KNOWN_ERRORS)[number] | "INTERNAL"}` {
  const known = KNOWN_ERRORS.find((k) => k === code);
  return `errors.${known ?? "INTERNAL"}`;
}

const primary =
  "min-h-11 w-full rounded-md bg-primary px-4 text-base font-semibold text-primary-fg disabled:opacity-60";
const secondary =
  "min-h-11 w-full rounded-md border border-border bg-bg px-4 text-base font-semibold text-fg disabled:opacity-60";

type Mode = "idle" | "reject" | "remove";

function FarmerRow({ farmer, kind }: { farmer: OfficerFarmerRow; kind: "pending" | "active" }) {
  const t = useTranslations("officer.farmers");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = farmer.membershipId;

  async function run(call: () => ReturnType<typeof approveFarmerAction>) {
    setBusy(true);
    setError(null);
    const outcome = await call();
    setBusy(false);
    if (!outcome.ok) {
      setError(t(errorKey(outcome.code)));
      return;
    }
    router.refresh();
  }

  function submitReason(event: FormEvent<HTMLFormElement>, which: "reject" | "remove") {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    const action = which === "reject" ? rejectFarmerAction : removeFarmerAction;
    void run(() => action({ membershipId: id, reason }));
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface px-3 py-3">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">{farmer.name}</p>
        <p className="text-sm text-muted">
          {t("details", {
            size: farmer.farmSizeHectares,
            crops: farmer.crops.join(", "),
            lga: farmer.lga,
            state: farmer.state,
          })}
        </p>
        <p className="text-sm text-muted">
          {farmer.hasBankAccount ? t("bankAdded") : t("bankMissing")}
        </p>
      </div>
      <FormError message={error} />
      {mode === "idle" ? (
        kind === "pending" ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => approveFarmerAction({ membershipId: id }))}
              className={primary}
            >
              {busy ? t("approving") : t("approve")}
            </button>
            <button type="button" onClick={() => setMode("reject")} className={secondary}>
              {t("reject")}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setMode("remove")} className={secondary}>
            {t("remove")}
          </button>
        )
      ) : (
        <form
          onSubmit={(event) => submitReason(event, mode)}
          className="flex flex-col gap-3"
          aria-label={mode === "reject" ? t("reject") : t("remove")}
        >
          <p className="text-base">
            {mode === "reject" ? t("rejectWarning") : t("removeWarning")}
          </p>
          <label htmlFor={`reason-${id}`} className="text-sm font-medium">
            {mode === "reject" ? t("rejectReasonLabel") : t("removeReasonLabel")}
          </label>
          <textarea
            id={`reason-${id}`}
            name="reason"
            required
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-fg"
          />
          <button type="submit" disabled={busy} className={primary}>
            {mode === "reject"
              ? busy
                ? t("rejecting")
                : t("rejectConfirm")
              : busy
                ? t("removing")
                : t("removeConfirm")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("idle");
              setError(null);
            }}
            className={secondary}
          >
            {t("cancel")}
          </button>
        </form>
      )}
    </li>
  );
}

export function FarmersPanel({
  pending,
  active,
}: {
  pending: OfficerFarmerRow[];
  active: OfficerFarmerRow[];
}) {
  const t = useTranslations("officer.farmers");
  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
          {t("pendingHeading")}
        </h2>
        {pending.length === 0 ? (
          <p className="text-base text-muted">{t("pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((farmer) => (
              <FarmerRow key={farmer.membershipId} farmer={farmer} kind="pending" />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-semibold">
          {t("activeHeading")}
        </h2>
        {active.length === 0 ? (
          <p className="text-base text-muted">{t("activeEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((farmer) => (
              <FarmerRow key={farmer.membershipId} farmer={farmer} kind="active" />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
