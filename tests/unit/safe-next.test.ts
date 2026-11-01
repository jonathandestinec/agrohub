import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps a relative path", () => {
    expect(safeNext("/join/abc")).toBe("/join/abc");
    expect(safeNext("/farmer")).toBe("/farmer");
    expect(safeNext("/join/abc?x=1#y")).toBe("/join/abc?x=1#y");
  });

  it.each([
    ["an absolute url", "https://evil.example"],
    ["a protocol-relative url", "//evil.example"],
    ["a backslash path", "/\\evil"],
    ["a backslash later in the path", "/a\\..\\\\evil.example"],
    ["a tab that browsers strip", "/\t/evil.example"],
    ["a newline", "/\n/evil.example"],
    ["a javascript url", "javascript:alert(1)"],
    ["a path without a leading slash", "join/abc"],
    ["an empty string", ""],
  ])("falls back to / for %s", (_label, value) => {
    expect(safeNext(value)).toBe("/");
  });

  it("falls back to / for a missing or non-string value", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(["/join/abc"])).toBe("/");
  });
});

describe("withNext", () => {
  it("adds an encoded next to a link", () => {
    expect(withNext("/sign-in", "/join/abc")).toBe("/sign-in?next=%2Fjoin%2Fabc");
  });

  it("leaves the default and unsafe values off", () => {
    expect(withNext("/sign-in", "/")).toBe("/sign-in");
    expect(withNext("/sign-in", "//evil.example")).toBe("/sign-in");
  });
});
