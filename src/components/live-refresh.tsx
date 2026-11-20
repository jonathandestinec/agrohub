"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { useLiveTopic } from "@/lib/live/live-provider";

// Put on a page that should update by itself: when the topic's version changes the page's server
// data is fetched again and swapped in. The old page stays on screen meanwhile, and what the
// person is typing is kept (only server-rendered parts change). Renders nothing.
// `initialVersion` must be read before the page loads its data, so a change in between is not lost.
export function LiveRefresh({
  topic,
  intervalMs,
  initialVersion,
  minGapMs,
  backoffSteps,
}: {
  topic: string;
  intervalMs: number;
  initialVersion?: string;
  minGapMs?: number;
  backoffSteps?: number[];
}) {
  const router = useRouter();
  useLiveTopic({ key: topic, intervalMs, initialVersion, minGapMs, backoffSteps }, (_version, _data, baseline) => {
    if (!baseline) startTransition(() => router.refresh());
  });
  return null;
}
