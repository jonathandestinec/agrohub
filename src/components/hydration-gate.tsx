"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";

// Wraps everything inside a client form. Until React hydrates, the fields hold their values in
// React state that does not exist yet: text typed then is reset when React takes over, and a
// press submits the page natively. A disabled fieldset disables every control in it, so the
// form waits. `display: contents` keeps the form's own layout; globals.css keeps the normal
// look (no dimming, a progress cursor) while it waits.
export function HydrationGate({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <fieldset disabled={!hydrated} aria-busy={hydrated ? undefined : true} className="hydration-gate contents">
      {children}
    </fieldset>
  );
}
