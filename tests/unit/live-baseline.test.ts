import { describe, expect, it } from "vitest";
import { isBaselineForListener } from "@/lib/live/baseline";

// A topic shared by several components (the bell and a page both watch `alerts`) answers its first
// poll as a baseline for the first one. A component that rendered from an older version must still
// see a real change in that first answer.
describe("isBaselineForListener", () => {
  it("is not a baseline once the topic has answered before", () => {
    expect(isBaselineForListener(false, "2", undefined)).toBe(false);
    expect(isBaselineForListener(false, "2", "1")).toBe(false);
  });

  it("is a baseline for a listener with no version of its own", () => {
    expect(isBaselineForListener(true, "1", undefined)).toBe(true);
  });

  it("is a baseline when the listener's rendered version is still current", () => {
    expect(isBaselineForListener(true, "1", "1")).toBe(true);
  });

  it("is a real change when the first answer differs from what the listener rendered from", () => {
    expect(isBaselineForListener(true, "2", "1")).toBe(false);
  });
});
