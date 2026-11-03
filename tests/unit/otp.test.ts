import { describe, expect, it } from "vitest";
import { otpDigits } from "@/lib/otp";

describe("otpDigits", () => {
  it("keeps only digits, up to the code length", () => {
    expect(otpDigits("123456", 6)).toBe("123456");
    expect(otpDigits("123 456", 6)).toBe("123456");
    expect(otpDigits("12-34-56-78", 6)).toBe("123456");
  });

  it("drops letters and whitespace from a pasted code", () => {
    expect(otpDigits(" a1b2c3\n", 6)).toBe("123");
    expect(otpDigits("", 6)).toBe("");
  });
});
