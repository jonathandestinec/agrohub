import type { InputHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { ClippedPhoto, PhotoCredit } from "@/components/ui/clipped-photo";
import type { PhotoKey } from "@/components/ui/photo-credits";

// Shared building blocks for single-form pages (mobile-first, 44px targets). With a photo,
// the form sits beside a clipped photograph on wide screens; phones get the form alone.

export function AuthCard({
  title,
  lead,
  photo,
  caption = "",
  children,
}: {
  title: string;
  lead?: string;
  photo?: PhotoKey;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="grid flex-1 gap-2 md:grid-cols-12">
      <section className={`min-w-0 rounded-panel bg-paper px-4 py-8 md:px-10 md:py-14 ${photo ? "md:col-span-7" : "md:col-span-12"}`}>
        <div className="mx-auto w-full max-w-md">
          <h1 className="heading-3 break-words">{title}</h1>
          {lead ? <p className="mt-3 body-3 text-ink-soft">{lead}</p> : null}
          <div className="mt-8 flex flex-col gap-5">{children}</div>
        </div>
      </section>
      {photo ? (
        <div className="hidden md:col-span-5 md:block">
          <ClippedPhoto photo={photo} caption={caption} />
          <PhotoCredit photo={photo} />
        </div>
      ) : null}
    </main>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-input bg-step px-4 body-3 text-ink outline-offset-2 placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-bad";

export function Field({
  label,
  hint,
  error,
  ...input
}: { label: string; hint?: string; error?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${input.id}-hint` : undefined;
  const errorId = error ? `${input.id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={input.id} className="title-4">
        {label}
      </label>
      <input
        {...input}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={inputClass}
      />
      {hint ? (
        <p id={hintId} className="body-6 text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="body-6 text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  pending,
  label,
  pendingLabel,
  disabled = false,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <button type="submit" disabled={pending || disabled} className={`${buttonClass("ink", "lg")} w-full`}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex gap-3 rounded-tile bg-bad-soft px-4 py-3 body-6 text-ink">
      <span aria-hidden="true" className="w-1 shrink-0 rounded-full bg-bad" />
      {message}
    </p>
  );
}
