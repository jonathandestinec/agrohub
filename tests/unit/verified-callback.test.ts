import { describe, expect, it } from "vitest";
import { withVerifiedCallback } from "@/lib/verified-callback";

const BASE = "http://localhost:3000/api/auth/verify-email?token=abc";

function linkWith(callbackURL: string | null): string {
  return callbackURL === null ? BASE : `${BASE}&callbackURL=${encodeURIComponent(callbackURL)}`;
}

function callbackOf(url: string): string | null {
  return new URL(url).searchParams.get("callbackURL");
}

describe("withVerifiedCallback", () => {
  it("pins the callback to /verified when sign-up had no next", () => {
    expect(callbackOf(withVerifiedCallback(linkWith("/verified")))).toBe("/verified");
    expect(callbackOf(withVerifiedCallback(linkWith(null)))).toBe("/verified");
    expect(callbackOf(withVerifiedCallback(linkWith("/")))).toBe("/verified");
  });

  it("carries a safe next through to /verified", () => {
    const out = withVerifiedCallback(linkWith("/verified?next=%2Fjoin%2Fabc"));
    expect(callbackOf(out)).toBe("/verified?next=%2Fjoin%2Fabc");
    expect(new URL(out).searchParams.get("token")).toBe("abc");
  });

  it("keeps a next with its own query string intact", () => {
    const next = "/join/abc?x=1";
    const out = withVerifiedCallback(linkWith(`/verified?next=${encodeURIComponent(next)}`));
    expect(callbackOf(out)).toBe(`/verified?next=${encodeURIComponent(next)}`);
  });

  it.each([
    ["an absolute url", "https://evil.example/phish"],
    ["a protocol-relative url", "//evil.example"],
    ["a backslash path", "/\\evil.example"],
    ["a javascript url", "javascript:alert(1)"],
  ])("drops %s given as next", (_label, next) => {
    const out = withVerifiedCallback(linkWith(`/verified?next=${encodeURIComponent(next)}`));
    expect(callbackOf(out)).toBe("/verified");
  });

  it("ignores a callback that is not /verified, whatever it is", () => {
    expect(callbackOf(withVerifiedCallback(linkWith("https://evil.example/phish")))).toBe(
      "/verified",
    );
    expect(callbackOf(withVerifiedCallback(linkWith("/join/abc")))).toBe("/verified");
    expect(
      callbackOf(withVerifiedCallback(linkWith("https://evil.example/verified?next=%2Ffarmer"))),
    ).toBe("/verified");
  });
});
