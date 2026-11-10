import { describe, expect, it } from "vitest";
import { menuStep } from "@/components/ui/menu-keys";

describe("menuStep", () => {
  it("opens onto the first item from the button on ArrowDown, and the last on ArrowUp", () => {
    expect(menuStep("ArrowDown", -1, 3)).toBe(0);
    expect(menuStep("ArrowUp", -1, 3)).toBe(2);
  });

  it("moves down and up through the items, wrapping at the ends", () => {
    expect(menuStep("ArrowDown", 0, 3)).toBe(1);
    expect(menuStep("ArrowDown", 2, 3)).toBe(0);
    expect(menuStep("ArrowUp", 1, 3)).toBe(0);
    expect(menuStep("ArrowUp", 0, 3)).toBe(2);
  });

  it("jumps to the first and last item on Home and End", () => {
    expect(menuStep("Home", 2, 3)).toBe(0);
    expect(menuStep("End", 0, 3)).toBe(2);
  });

  it("ignores other keys, and an empty menu", () => {
    expect(menuStep("a", 0, 3)).toBeNull();
    expect(menuStep("Tab", 0, 3)).toBeNull();
    expect(menuStep("ArrowDown", -1, 0)).toBeNull();
  });
});
