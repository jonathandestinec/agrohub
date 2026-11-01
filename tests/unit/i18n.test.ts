import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enabledLocales, locales, resolveLocale } from "@/i18n/config";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Unexpected non-object at "${prefix}"`);
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[path] = child;
    else Object.assign(out, flatten(child, path));
  }
  return out;
}

function load(locale: string) {
  const file = join(process.cwd(), "messages", `${locale}.json`);
  return flatten(JSON.parse(readFileSync(file, "utf8")));
}

describe("i18n config", () => {
  it("resolve_locale_falls_back_to_english", () => {
    expect(resolveLocale("ha")).toBe("en");
  });

  it("falls back to english for undefined and unknown input", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
  });

  it("serves a locale only when it is enabled", () => {
    expect(resolveLocale("ha", ["en", "ha"])).toBe("ha");
  });

  it("matches exactly and case-sensitively", () => {
    expect(resolveLocale("EN", ["en", "ha"])).toBe("en");
    expect(resolveLocale("HA", ["en", "ha"])).toBe("en");
    expect(resolveLocale("ha-NG", ["en", "ha"])).toBe("en");
  });

  it("only English is enabled until a native speaker reviews the others", () => {
    expect([...enabledLocales]).toEqual(["en"]);
  });
});

describe("message files", () => {
  const english = Object.keys(load("en")).sort();

  it("en has at least one key", () => {
    expect(english.length).toBeGreaterThan(0);
  });

  for (const locale of locales.filter((l) => l !== "en")) {
    it(`${locale} has exactly the keys of en`, () => {
      expect(Object.keys(load(locale)).sort()).toEqual(english);
    });
  }
});
