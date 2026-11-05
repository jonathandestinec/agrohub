"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/auth-ui";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { orderErrorKey } from "./error-key";

const FIELD = "min-h-11 w-full rounded-tile bg-paper px-3 body-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink";

// One order action behind a button (the server action comes bound to the order).
export function OrderActionButton({
  action,
  label,
  tone = "ink",
  confirm,
}: {
  action: () => Promise<ActionResult<unknown>>;
  label: string;
  tone?: "ink" | "paper";
  confirm?: string;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(t(orderErrorKey(result.code)));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" tone={tone} disabled={pending} onClick={onClick}>
          {label}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

// One order action that takes one value: a date, a quantity or a reason.
export function OrderFieldForm({
  action,
  heading,
  label,
  submit,
  kind,
  defaultValue = "",
  hint,
  name,
}: {
  action: (value: string) => Promise<ActionResult<unknown>>;
  heading?: string;
  label: string;
  submit: string;
  kind: "date" | "number" | "text";
  defaultValue?: string;
  hint?: string;
  name: string;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await action(value);
    setPending(false);
    if (!result.ok) {
      setError(t(orderErrorKey(result.code)));
      return;
    }
    if (kind === "text") setValue("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-inner bg-paper/60 p-4 md:p-6">
      {heading ? <h2 className="title-2">{heading}</h2> : null}
      <label className="flex flex-col gap-1 body-6">
        {label}
        {kind === "text" ? (
          <textarea name={name} value={value} onChange={(e) => setValue(e.target.value)} required maxLength={1000} rows={3} className={`${FIELD} py-2`} />
        ) : (
          <input
            name={name}
            type={kind}
            inputMode={kind === "number" ? "numeric" : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className={FIELD}
          />
        )}
      </label>
      {hint ? <p className="body-6 text-ink-soft">{hint}</p> : null}
      <FormError message={error} />
      <div>
        <Button type="submit" tone="ink" disabled={pending}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
