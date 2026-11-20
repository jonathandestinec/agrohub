// Whether an answer is only a "baseline" for one listener of a topic, or a change it must act on.
// The controller marks the first answer of a topic that started with no version as a baseline. But
// a topic can be shared (the bell and a page both watch `alerts`), and a listener that rendered
// from a version of its own must still see a difference in that first answer: that is a change that
// happened between its render and the first poll.
export function isBaselineForListener(baseline: boolean, version: string, listenerInitialVersion: string | undefined): boolean {
  if (!baseline) return false;
  return listenerInitialVersion === undefined || version === listenerInitialVersion;
}
