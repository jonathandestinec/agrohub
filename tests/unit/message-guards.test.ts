import { describe, expect, it } from "vitest";
import { amountsIn } from "@/lib/money";
import { hasContactDetails, mentionsAmount } from "@/modules/messaging/guards";

describe("hasContactDetails", () => {
  it.each([
    "call 08031234567",
    "+234 803 123 4567",
    "0803-123-4567",
    "my number is 0703 123 4567 ok",
    "2348031234567",
    "mail me at a@b.co",
    "Reach ngozi.okafor@example.com today",
    "(0803) 123 4567",
    "0803.123.4567",
  ])("finds contact details in %j", (text) => {
    expect(hasContactDetails(text)).toBe(true);
  });

  it.each(["50 bags at 6,500 each", "deliver on 12/11", "₦43,219.87 per bag", "order 2026-11-03", "100000 kg", "on 12.11.2026"])(
    "finds none in %j",
    (text) => {
      expect(hasContactDetails(text)).toBe(false);
    },
  );
});

describe("amountsIn", () => {
  it("reads each number as naira and as plain kobo", () => {
    const amounts = amountsIn("₦500 and 1,200.50");
    expect(amounts).toContain(50_000);
    expect(amounts).toContain(500);
    expect(amounts).toContain(120_050);
  });

  it("finds nothing in text without numbers", () => {
    expect(amountsIn("no numbers here")).toEqual([]);
  });
});

describe("mentionsAmount", () => {
  it.each(["can't go under ₦43,219.87", "43219.87", "N43,219.87", "4321987", "floor is 43,219.87 naira"])(
    "finds ₦43,219.87 in %j",
    (text) => {
      expect(mentionsAmount(text, 4_321_987)).toBe(true);
    },
  );

  it.each(["43 219.87", "43.219,87", "₦43.2k", "43k"])("finds ₦43,219.87 written as %j", (text) => {
    expect(mentionsAmount(text, 4_321_987)).toBe(true);
  });

  it("finds the amount as a line total for a quantity", () => {
    expect(mentionsAmount("₦432,198.70 for ten bags", 4_321_987, [10])).toBe(true);
    expect(mentionsAmount("₦432,198.70 for ten bags", 4_321_987, [5])).toBe(false);
  });

  it.each(["₦43,000", "43,219.8", "432198", "45k"])("does not find ₦43,219.87 in %j", (text) => {
    expect(mentionsAmount(text, 4_321_987)).toBe(false);
  });

  it("finds a whole-naira amount written with or without kobo", () => {
    expect(mentionsAmount("lowest is ₦550", 55_000)).toBe(true);
    expect(mentionsAmount("lowest is 550.00", 55_000)).toBe(true);
    expect(mentionsAmount("lowest is 55,000 kobo", 55_000)).toBe(true);
  });
});
