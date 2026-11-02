import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Small shared pieces for the demo screens. Icons are drawn here rather than adding a library.

export function ArrowRight({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpRight({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M7 17 17 7m0 0H8m9 0v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Tone = "ink" | "lime" | "paper" | "step";
const TONES: Record<Tone, string> = {
  ink: "bg-[var(--d-ink)] text-white hover:bg-[#2a3028]",
  lime: "bg-[var(--d-lime)] text-[var(--d-lime-ink)] hover:bg-[#d0e45c]",
  paper: "bg-[var(--d-paper)] text-[var(--d-ink)] hover:bg-[var(--d-step)]",
  step: "bg-[var(--d-step)] text-[var(--d-ink)] hover:bg-[var(--d-step-2)]",
};
const BUTTON =
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2 button-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--d-ink)] disabled:opacity-50 disabled:pointer-events-none";

export function ButtonLink({
  tone = "ink",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { tone?: Tone }) {
  return <Link {...props} className={`${BUTTON} ${TONES[tone]} ${className}`} />;
}

export function Button({
  tone = "ink",
  className = "",
  ...props
}: ComponentProps<"button"> & { tone?: Tone }) {
  return <button type="button" {...props} className={`${BUTTON} ${TONES[tone]} ${className}`} />;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-[var(--d-paper)] p-6 md:p-8 ${className}`}>{children}</section>;
}

export function Chip({ children, tone = "step" }: { children: ReactNode; tone?: "step" | "lime" | "forest" | "warn" }) {
  const tones = {
    step: "bg-[var(--d-step)] text-[var(--d-ink-2)]",
    lime: "bg-[var(--d-lime)] text-[var(--d-lime-ink)]",
    forest: "bg-[var(--d-forest)] text-[var(--d-forest-ink)]",
    warn: "bg-[#fbefd2] text-[var(--d-warn)]",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 caption-4 ${tones[tone]}`}>{children}</span>;
}

// A flat colour field standing in for a crop photograph.
export function CropField({
  name,
  field,
  ink,
  className = "",
}: {
  name: string;
  field: string;
  ink: string;
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-end overflow-hidden ${className}`}
      style={{ background: field, color: ink }}
      role="img"
      aria-label={name}
    >
      <span aria-hidden="true" className="select-none p-4 heading-3 opacity-90">
        {name}
      </span>
    </div>
  );
}

export function PageHeading({ title, lead, children }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-[680px]">
        <h1 className="heading-3">{title}</h1>
        {lead ? <p className="mt-3 body-3 text-[var(--d-ink-2)]">{lead}</p> : null}
      </div>
      {children}
    </div>
  );
}
