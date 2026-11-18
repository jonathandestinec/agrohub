"use client";

import { buttonClass } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

export function SubmitButton({
  pending,
  label,
  pendingLabel,
  disabled = false,
  waitForHydration = false,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
  // For forms submitted by a client onSubmit handler (the password forms): a click before
  // hydration would submit the page natively. Server-action forms work before hydration
  // (React replays the submit), so they leave this off.
  waitForHydration?: boolean;
}) {
  const hydrated = useHydrated();
  return (
    <button
      type="submit"
      disabled={(waitForHydration && !hydrated) || pending || disabled}
      className={`${buttonClass("ink", "lg")} w-full`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
