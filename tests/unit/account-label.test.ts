import { describe, expect, it } from "vitest";
import { firstName, initials } from "@/components/account-label";

describe("firstName", () => {
  it("is the first word of the name", () => {
    expect(firstName("Amina Bello")).toBe("Amina");
    expect(firstName("  Chidi   Okafor Jr ")).toBe("Chidi");
  });

  it("is the whole name when it is one word, and empty for a blank name", () => {
    expect(firstName("Tunde")).toBe("Tunde");
    expect(firstName("   ")).toBe("");
  });
});

describe("initials", () => {
  it("is the first letters of the first and last words, in capitals", () => {
    expect(initials("Amina Bello")).toBe("AB");
    expect(initials("chidi nnamdi okafor")).toBe("CO");
  });

  it("is one letter for a one-word name, and a placeholder for a blank one", () => {
    expect(initials("tunde")).toBe("T");
    expect(initials(" ")).toBe("?");
  });
});
