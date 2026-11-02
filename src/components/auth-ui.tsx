import type { InputHTMLAttributes, ReactNode } from "react";

// Shared, token-styled building blocks for the auth pages (mobile-first, 44px targets).

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold">
        {title}
      </h1>
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </main>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${input.id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={input.id} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...input}
        aria-describedby={hintId}
        className="min-h-11 w-full rounded-md border border-border bg-bg px-3 text-base text-fg"
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-md bg-primary px-4 text-base font-semibold text-primary-fg disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
    >
      {message}
    </p>
  );
}
