import { describe, expect, it } from "vitest";
import { namesMatch } from "@/modules/banking/names";

// Row 1 was false in the plan; corrected to true by controller ruling: abbreviated
// legal suffixes (COOP SOC) are exactly what the ignore list exists for.
const table: Array<[string, string, boolean]> = [
  ["Ogun Farmers Cooperative Society", "OGUN FARMERS COOP SOC", true],
  ["Ogun Farmers Cooperative", "OGUN FARMERS MULTIPURPOSE COOPERATIVE SOCIETY LTD", true],
  ["Ada Obi", "OBI ADA CHIOMA", true],
  ["Ada Obi", "ADA OKAFOR", false],
  // Whole tokens only, never substrings.
  ["Ada Obi", "ADAM OBI", false],
];

describe("namesMatch", () => {
  it.each(table)("(%s, %s) -> %s", (registered, resolved, expected) => {
    expect(namesMatch(registered, resolved)).toBe(expected);
  });

  it("is never vacuously true when only ignored tokens remain", () => {
    expect(namesMatch("Cooperative Society Ltd", "ANY NAME LTD")).toBe(false);
    expect(namesMatch("", "ADA OBI")).toBe(false);
    expect(namesMatch("  .,  ", "ADA OBI")).toBe(false);
  });

  it("ignores case and punctuation", () => {
    expect(namesMatch("ada-obi's farm", "ADA-OBIS FARM NIG. LTD")).toBe(true);
    expect(namesMatch("Zaria Growers (Nig.) Limited", "zaria growers")).toBe(true);
  });
});
