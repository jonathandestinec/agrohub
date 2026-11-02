import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { toAdminFarmer, toOfficerFarmer, toOwnFarmer } from "@/modules/farmers/views";

const PHONE = "+2348098765432";
const EMAIL = "ada.okafor@example.com";
const RECIPIENT = "RCP_secretcode123";

const profile = {
  id: "fp-1",
  userId: "u-1",
  cooperativeId: "coop-1",
  farmSizeHectares: new Prisma.Decimal("2.50"),
  crops: ["Maize", "Cassava"],
  state: "Ogun",
  lga: "Abeokuta North",
  recipientCode: RECIPIENT,
  accountName: "ADA OKAFOR",
  createdAt: new Date("2031-06-10T12:00:00Z"),
  updatedAt: new Date("2031-06-10T12:00:00Z"),
};

const user = {
  id: "u-1",
  name: "Ada Okafor",
  email: EMAIL,
  phone: PHONE,
  phoneConfirmed: false,
};

describe("farmer views", () => {
  it("phone_visible_to_admins_only", () => {
    const officer = JSON.stringify(toOfficerFarmer(profile, user));
    expect(officer).not.toContain(PHONE);
    expect(officer).not.toContain(EMAIL);
    expect(officer).not.toContain(RECIPIENT);
    expect(officer).not.toMatch(/phone|email|recipientCode|accountNumber/i);

    const admin = toAdminFarmer(profile, user);
    expect(JSON.stringify(admin)).toContain(PHONE);
    expect(admin.phone).toBe(PHONE);
    expect(admin.phoneConfirmed).toBe(false);
    expect(JSON.stringify(admin)).not.toContain(RECIPIENT);
  });

  it("shows the officer the profile and whether a bank account is set", () => {
    expect(toOfficerFarmer(profile, user)).toEqual({
      id: "fp-1",
      userId: "u-1",
      name: "Ada Okafor",
      cooperativeId: "coop-1",
      farmSizeHectares: "2.5",
      crops: ["Maize", "Cassava"],
      state: "Ogun",
      lga: "Abeokuta North",
      hasBankAccount: true,
    });
    expect(toOfficerFarmer({ ...profile, recipientCode: null }, user).hasBankAccount).toBe(false);
  });

  it("gives the farmer their own profile without the recipient code", () => {
    const own = toOwnFarmer(profile);
    expect(own).toEqual({
      farmSizeHectares: "2.5",
      crops: ["Maize", "Cassava"],
      state: "Ogun",
      lga: "Abeokuta North",
    });
    expect(JSON.stringify(own)).not.toContain(RECIPIENT);
  });
});
