import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import type { Role } from "@/modules/identity/policies";
import { requireSecondFactor } from "@/modules/identity/second-factor";

const cases: ReadonlyArray<readonly [Role, boolean, boolean]> = [
  // [role, twoFactorVerified, expectedToThrow]
  ["FARMER", true, false],
  ["FARMER", false, false],
  ["OFFICER", true, false],
  ["OFFICER", false, false],
  ["BUYER", true, false],
  ["BUYER", false, false],
  ["ADMIN", true, false],
  ["ADMIN", false, true],
  ["BOARD_ADMIN", true, false],
  ["BOARD_ADMIN", false, true],
];

describe("requireSecondFactor", () => {
  it.each(cases)("role %s, twoFactorVerified %s, throws: %s", (role, twoFactorVerified, shouldThrow) => {
    const call = () => requireSecondFactor({ role, twoFactorVerified });
    if (!shouldThrow) {
      expect(call).not.toThrow();
      return;
    }
    let caught: unknown;
    try {
      call();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    expect((caught as ForbiddenError).code).toBe("2FA_REQUIRED");
  });
});
