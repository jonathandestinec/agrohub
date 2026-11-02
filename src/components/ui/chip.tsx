import type { ReactNode } from "react";

export type ChipTone = "step" | "lime" | "forest" | "warn";

const TONES: Record<ChipTone, string> = {
  step: "bg-step text-ink-soft",
  lime: "bg-lime text-lime-ink",
  forest: "bg-forest text-forest-ink",
  warn: "bg-warn-soft text-warn",
};

export function Chip({ children, tone = "step" }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 caption-4 ${TONES[tone]}`}>
      {children}
    </span>
  );
}
