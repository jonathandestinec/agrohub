import Link from "next/link";
import type { ComponentProps } from "react";

// Pill buttons from the demo: 44px minimum, 48px for a page's primary action, 0.97 press.

export type Tone = "ink" | "lime" | "step" | "paper";
type Size = "md" | "lg";

const TONES: Record<Tone, string> = {
  ink: "bg-ink text-paper hover:bg-[#2a3028]",
  lime: "bg-lime text-lime-ink hover:bg-[#d0e45c]",
  step: "bg-step text-ink hover:bg-step-deep",
  paper: "bg-paper text-ink hover:bg-step",
};
const SIZES: Record<Size, string> = {
  md: "min-h-11 px-5",
  lg: "min-h-12 px-6",
};
const BASE =
  "press inline-flex items-center justify-center gap-2 rounded-full py-2 button-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50";

export function buttonClass(tone: Tone = "ink", size: Size = "md"): string {
  return `${BASE} ${SIZES[size]} ${TONES[tone]}`;
}

export function Button({
  tone = "ink",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { tone?: Tone; size?: Size }) {
  return <button type={type} {...props} className={`${buttonClass(tone, size)} ${className}`} />;
}

export function ButtonLink({
  tone = "ink",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { tone?: Tone; size?: Size }) {
  return <Link {...props} className={`${buttonClass(tone, size)} ${className}`} />;
}
