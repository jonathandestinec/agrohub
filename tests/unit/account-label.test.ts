import { describe, expect, it } from "vitest";
import { initials } from "@/components/account-label";

describe("initials", () => {
  it("is the first letters of the first and last words, in capitals", () => {
    expect(initials("Amina Bello")).toBe("AB");
    expect(initials("chidi nnamdi okafor")).toBe("CO");
    expect(initials("  Chidi   Okafor Jr ")).toBe("CJ");
  });

  it("is the first two letters of a one-word name", () => {
    expect(initials("tunde")).toBe("TU");
    expect(initials("Ngozi")).toBe("NG");
  });

  it("is one letter for a one-letter name, and a placeholder for a blank one", () => {
    expect(initials("a")).toBe("A");
    expect(initials(" ")).toBe("?");
  });

  it("counts a letter outside the basic alphabet as one letter", () => {
    expect(initials("Ọlá Adéyemí")).toBe("ỌA");
    expect(initials("Ìbíyẹ̀mí")).toBe("ÌB");
  });
});
