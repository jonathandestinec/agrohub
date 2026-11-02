import type { ReactNode } from "react";

// Surfaces are separated by tone steps, never borders or shadows (DESIGN.md, Tone Step Rule).

export function Panel({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return <Tag className={`rounded-panel bg-paper p-6 md:p-8 ${className}`}>{children}</Tag>;
}

export function Card({
  children,
  className = "",
  tone = "step",
}: {
  children: ReactNode;
  className?: string;
  tone?: "step" | "paper";
}) {
  const fill = tone === "step" ? "bg-step" : "bg-paper";
  return <div className={`rounded-inner p-4 md:p-6 ${fill} ${className}`}>{children}</div>;
}
