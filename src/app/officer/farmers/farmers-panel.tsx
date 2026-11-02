"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Chip } from "@/components/ui";
import type { OfficerFarmerRow } from "@/modules/farmers/service";
import {
  approveFarmerAction,
  rejectFarmerAction,
  removeFarmerAction,
} from "../actions";
import { buttonClass } from "@/components/ui/button";

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
  `${buttonClass("ink")} w-full`;
const secondary =
  `${buttonClass("paper")} w-full`;

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
    <li className="flex flex-col gap-3 rounded-inner bg-step p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <p className="title-2 break-words">{farmer.name}</p>
        <p className="body-6 text-ink-soft">
          {t("details", {
            size: farmer.farmSizeHectares,
            crops: farmer.crops.join(", "),
            lga: farmer.lga,
            state: farmer.state,
          })}
        </p>
        <p className="body-6 text-ink-soft">
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
          <p className="body-3">
            {mode === "reject" ? t("rejectWarning") : t("removeWarning")}
          </p>
          <label htmlFor={`reason-${id}`} className="title-4">
            {mode === "reject" ? t("rejectReasonLabel") : t("removeReasonLabel")}
          </label>
          <textarea
            id={`reason-${id}`}
            name="reason"
            required
            maxLength={500}
            rows={3}
            className="w-full rounded-input bg-paper px-4 py-3 body-3 text-ink"
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
    <div className="grid gap-2 md:grid-cols-2">
      <section className="flex flex-col gap-4 rounded-inner bg-paper p-4 md:p-6">
        <h2 className="flex items-center gap-3 heading-6">
          {t("pendingHeading")}
          <Chip tone={pending.length > 0 ? "warn" : "step"}>{pending.length}</Chip>
        </h2>
        {pending.length === 0 ? (
          <p className="body-3 text-ink-soft">{t("pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((farmer) => (
              <FarmerRow key={farmer.membershipId} farmer={farmer} kind="pending" />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-4 rounded-inner bg-paper p-4 md:p-6">
        <h2 className="flex items-center gap-3 heading-6">
          {t("activeHeading")}
          <Chip tone="forest">{active.length}</Chip>
        </h2>
        {active.length === 0 ? (
          <p className="body-3 text-ink-soft">{t("activeEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((farmer) => (
              <FarmerRow key={farmer.membershipId} farmer={farmer} kind="active" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
