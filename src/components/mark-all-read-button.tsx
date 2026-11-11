"use client";

import { useTransition } from "react";
import { markAllAlertsReadAction } from "@/app/alerts/actions";
import { buttonClass } from "@/components/ui";

// Marks every alert for the role in use as read. The action revalidates the layout, so the
// bell in the header takes the new count without a reload.
export function MarkAllReadButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await markAllAlertsReadAction()))}
      className={`${buttonClass("paper")} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
