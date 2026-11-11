import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEE_ALL, TILE_IDS } from "@/modules/home/tiles";

type Tree = { [key: string]: string | Tree };
const english = JSON.parse(readFileSync(join(process.cwd(), "messages", "en.json"), "utf8")) as { home: Tree };

function strings(tree: Tree): string[] {
  return Object.values(tree).flatMap((v) => (typeof v === "string" ? [v] : strings(v)));
}

describe("home copy", () => {
  it("has_a_title_and_an_empty_line_for_every_tile", () => {
    const tiles = english.home.tiles as Record<string, string>;
    const empty = english.home.empty as Record<string, string>;
    for (const id of TILE_IDS) {
      expect(tiles[id], `title of ${id}`).toBeTruthy();
      expect(empty[id], `empty line of ${id}`).toBeTruthy();
    }
  });

  it("sends_every_tile_to_a_page_that_exists", () => {
    for (const id of TILE_IDS) expect(SEE_ALL[id]).toMatch(/^\/[a-z]+(\/[a-z]+)?$/);
  });

  it("never_calls_the_held_payment_escrow", () => {
    for (const text of strings(english.home)) expect(text.toLowerCase()).not.toContain("escrow");
  });

  it("has_the_words_the_schedule_and_the_onboarding_notice_need", () => {
    const home = english.home as unknown as { officer: Tree; schedule: Tree };
    expect(home.officer.onboarding).toBe("Finish onboarding to start selling");
    for (const key of ["title", "overdue", "noDate", "later", "empty"]) expect(home.schedule[key]).toBeTruthy();
  });
});
