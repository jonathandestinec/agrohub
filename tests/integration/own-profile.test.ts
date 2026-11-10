import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { addMembership, getOwnProfile } from "@/modules/identity/service";
import { toOwnProfileView } from "@/modules/identity/views";
import { cleanDatabase, createTestCooperative, createTestUser } from "./helpers";

beforeEach(cleanDatabase);

describe("getOwnProfile", () => {
  it("returns the person's own details and their current memberships with the cooperative's name", async () => {
    const coop = await createTestCooperative({ name: "Zaria Growers" });
    const user = await createTestUser({ name: "Amina Bello", email: "amina@example.com", phone: "+2348011112222" });
    await addMembership({ userId: user.id, role: "FARMER", cooperativeId: coop.id });
    await addMembership({ userId: user.id, role: "BUYER" });

    const profile = await getOwnProfile({ userId: user.id });

    expect(profile.name).toBe("Amina Bello");
    expect(profile.email).toBe("amina@example.com");
    expect(profile.phone).toBe("+2348011112222");
    expect(profile.memberships).toEqual(
      expect.arrayContaining([
        { role: "FARMER", status: "ACTIVE", cooperativeName: "Zaria Growers" },
        { role: "BUYER", status: "ACTIVE", cooperativeName: null },
      ]),
    );
    expect(profile.memberships).toHaveLength(2);
  });

  it("includes a pending membership and leaves out one that ended", async () => {
    const coop = await createTestCooperative();
    const user = await createTestUser();
    await addMembership({ userId: user.id, role: "FARMER", cooperativeId: coop.id, status: "PENDING" });
    await addMembership({ userId: user.id, role: "BUYER", status: "LEFT" });

    const profile = await getOwnProfile({ userId: user.id });

    expect(profile.memberships.map((m) => `${m.role}:${m.status}`)).toEqual(["FARMER:PENDING"]);
  });

  it("works for a person with no membership at all", async () => {
    const user = await createTestUser();
    expect((await getOwnProfile({ userId: user.id })).memberships).toEqual([]);
  });

  it("refuses an unknown person", async () => {
    await expect(getOwnProfile({ userId: "nobody" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("toOwnProfileView", () => {
  it("carries the phone number to the page and no ids", async () => {
    const coop = await createTestCooperative({ name: "Zaria Growers" });
    // The helper's default name and email contain the id, so give this person their own.
    const user = await createTestUser({ name: "Amina Bello", email: "amina@example.com", phone: "+2348011112222" });
    await addMembership({ userId: user.id, role: "OFFICER", cooperativeId: coop.id });

    const json = JSON.stringify(toOwnProfileView(await getOwnProfile({ userId: user.id })));

    expect(json).toContain("+2348011112222");
    expect(json).toContain("Zaria Growers");
    expect(json).not.toContain(user.id);
    expect(json).not.toContain(coop.id);
  });
});
