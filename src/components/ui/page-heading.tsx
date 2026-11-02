import type { ReactNode } from "react";

export function PageHeading({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 max-w-[680px]">
        <h1 className="heading-3 break-words">{title}</h1>
        {lead ? <p className="mt-3 body-3 text-ink-soft">{lead}</p> : null}
      </div>
      {children}
    </div>
  );
}
