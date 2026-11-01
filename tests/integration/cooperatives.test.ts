import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { fakeStorage } from "@/lib/storage";
import {
  createCooperative,
  getDocumentUrl,
  updateCooperativeDetails,
  uploadDocument,
} from "@/modules/cooperatives/service";
import {
  toAdminCooperative,
  toOfficerCooperative,
} from "@/modules/cooperatives/views";
import type { Actor } from "@/modules/identity/policies";
import { cleanDatabase, createTestUser } from "./helpers";

const PDF = Buffer.from("%PDF-1.7 test body");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const input = {
  name: "Zaria Maize Growers",
  registrationNumber: "RC-1001",
  state: "Kaduna",
  lga: "Zaria",
  certificateExpiresAt: new Date("2030-01-01T00:00:00Z"),
};

async function officerWithCooperative(
  userId: string,
  registrationNumber: string,
) {
  const cooperative = await createCooperative(
    { userId },
    { ...input, registrationNumber },
  );
  const actor: Actor = {
    userId,
    role: "OFFICER",
    cooperativeId: cooperative.id,
    twoFactorEnabled: false,
  };
  return { cooperative, actor };
}

const admin: Actor = {
  userId: "admin-1",
  role: "ADMIN",
  cooperativeId: null,
  twoFactorEnabled: true,
};

beforeEach(async () => {
  await cleanDatabase();
  fakeStorage.clear();
  await createTestUser({ id: "u1" });
  await createTestUser({ id: "u2" });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("createCooperative", () => {
  it("makes one PENDING cooperative and one ACTIVE OFFICER membership", async () => {
    const cooperative = await createCooperative({ userId: "u1" }, input);
    expect(cooperative.status).toBe("PENDING");
    expect(await prisma.cooperative.count()).toBe(1);
    const memberships = await prisma.membership.findMany({
      where: { userId: "u1" },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      role: "OFFICER",
      status: "ACTIVE",
      cooperativeId: cooperative.id,
    });
  });

  it("rejects a second cooperative by the same user with ALREADY_OFFICER", async () => {
    await createCooperative({ userId: "u1" }, input);
    const error = await createCooperative(
      { userId: "u1" },
      { ...input, registrationNumber: "RC-2002" },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "ALREADY_OFFICER" });
    expect(await prisma.cooperative.count()).toBe(1);
  });

  it("rejects a duplicate registration number and leaves no membership behind", async () => {
    await createCooperative({ userId: "u1" }, input);
    const error = await createCooperative({ userId: "u2" }, input).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: "REGISTRATION_NUMBER_TAKEN" });
    expect(await prisma.membership.count({ where: { userId: "u2" } })).toBe(0);
  });

  it("rejects an unknown state", async () => {
    await expect(
      createCooperative({ userId: "u1" }, { ...input, state: "Atlantis" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("uploadDocument", () => {
  it("rejects text/html with a ValidationError", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    await expect(
      uploadDocument(actor, cooperative.id, {
        kind: "BYLAWS",
        body: Buffer.from("<html></html>"),
        contentType: "text/html",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects 10 485 761 bytes and accepts 10 485 760", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    const big = Buffer.alloc(10_485_761);
    PDF.copy(big);
    await expect(
      uploadDocument(actor, cooperative.id, {
        kind: "BYLAWS",
        body: big,
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const exact = Buffer.alloc(10_485_760);
    PDF.copy(exact);
    const doc = await uploadDocument(actor, cooperative.id, {
      kind: "BYLAWS",
      body: exact,
      contentType: "application/pdf",
    });
    expect(doc.sizeBytes).toBe(10_485_760);
  });

  it("rejects bytes that do not match the declared type with FILE_TYPE_MISMATCH", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    const cases: Array<[string, Buffer]> = [
      ["application/pdf", Buffer.from("<html>not a pdf</html>")],
      ["image/jpeg", PNG],
      ["image/png", JPEG],
      ["application/pdf", Buffer.alloc(0)],
    ];
    for (const [contentType, body] of cases) {
      const error = await uploadDocument(actor, cooperative.id, {
        kind: "BYLAWS",
        body,
        contentType,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ code: "FILE_TYPE_MISMATCH" });
    }
    expect(await prisma.cooperativeDocument.count()).toBe(0);
    expect(fakeStorage.objects.size).toBe(0);
  });

  it("stores the file privately under cooperatives/<id>/<kind>/<cuid>", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    const doc = await uploadDocument(actor, cooperative.id, {
      kind: "OFFICER_LIST",
      body: JPEG,
      contentType: "image/jpeg",
    });
    expect(doc.storageKey).toMatch(
      new RegExp(`^cooperatives/${cooperative.id}/OFFICER_LIST/[a-z0-9]+$`),
    );
    expect(fakeStorage.objects.get(doc.storageKey)?.contentType).toBe(
      "image/jpeg",
    );
    expect(doc).toMatchObject({ uploadedBy: "u1", sizeBytes: JPEG.length });
  });

  it("sets submittedAt once all three kinds are present, and a re-upload does not change it", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    const upload = (
      kind: "REGISTRATION_CERTIFICATE" | "BYLAWS" | "OFFICER_LIST",
    ) =>
      uploadDocument(actor, cooperative.id, {
        kind,
        body: PDF,
        contentType: "application/pdf",
        certificateExpiresAt: new Date("2099-01-01T00:00:00Z"),
      });
    const submittedAt = async () =>
      (
        await prisma.cooperative.findUniqueOrThrow({
          where: { id: cooperative.id },
        })
      ).submittedAt;
    await upload("REGISTRATION_CERTIFICATE");
    await upload("BYLAWS");
    expect(await submittedAt()).toBeNull();
    await upload("OFFICER_LIST");
    const submitted = await submittedAt();
    expect(submitted).toBeInstanceOf(Date);
    await upload("BYLAWS");
    expect(await submittedAt()).toEqual(submitted);
  });

  it("forbids an officer of another cooperative", async () => {
    const a = await officerWithCooperative("u1", "RC-A");
    const b = await officerWithCooperative("u2", "RC-B");
    await expect(
      uploadDocument(b.actor, a.cooperative.id, {
        kind: "BYLAWS",
        body: PDF,
        contentType: "application/pdf",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("updateCooperativeDetails", () => {
  const details = {
    name: "Zaria Maize Growers Union",
    registrationNumber: "RC-1001-A",
    state: "Kano",
    lga: "Nassarawa",
  };

  it("lets the officer correct a PENDING cooperative and audits cooperative.edit", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    const updated = await updateCooperativeDetails(actor, cooperative.id, details);
    expect(updated).toMatchObject(details);
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperative.id } });
    expect(row).toMatchObject({ ...details, status: "PENDING" });
    const audit = await prisma.auditLog.findMany({
      where: { action: "cooperative.edit", entityId: cooperative.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe("u1");
    expect(audit[0].meta).toEqual({ cooperativeId: cooperative.id });
  });

  it("keeps its own registration number without a conflict", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    await expect(
      updateCooperativeDetails(actor, cooperative.id, { ...details, registrationNumber: "RC-1" }),
    ).resolves.toMatchObject({ registrationNumber: "RC-1" });
  });

  it("refuses a VERIFIED or SUSPENDED cooperative with ILLEGAL_TRANSITION", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    for (const status of ["VERIFIED", "SUSPENDED"] as const) {
      await prisma.cooperative.update({ where: { id: cooperative.id }, data: { status } });
      const error = await updateCooperativeDetails(actor, cooperative.id, details).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ code: "ILLEGAL_TRANSITION" });
    }
    const row = await prisma.cooperative.findUniqueOrThrow({ where: { id: cooperative.id } });
    expect(row.name).toBe(input.name);
  });

  it("maps a registration number used by another cooperative to REGISTRATION_NUMBER_TAKEN", async () => {
    await officerWithCooperative("u1", "RC-A");
    const b = await officerWithCooperative("u2", "RC-B");
    await expect(
      updateCooperativeDetails(b.actor, b.cooperative.id, { ...details, registrationNumber: "RC-A" }),
    ).rejects.toMatchObject({ name: "ConflictError", code: "REGISTRATION_NUMBER_TAKEN" });
  });

  it("validates like create", async () => {
    const { cooperative, actor } = await officerWithCooperative("u1", "RC-1");
    for (const bad of [
      { ...details, state: "Atlantis" },
      { ...details, name: "x" },
      { ...details, lga: "" },
      { ...details, registrationNumber: " " },
    ]) {
      await expect(updateCooperativeDetails(actor, cooperative.id, bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("forbids an officer of another cooperative and an admin", async () => {
    const a = await officerWithCooperative("u1", "RC-A");
    const b = await officerWithCooperative("u2", "RC-B");
    await expect(
      updateCooperativeDetails(b.actor, a.cooperative.id, details),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateCooperativeDetails(admin, a.cooperative.id, details),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await prisma.auditLog.count({
        where: { action: "cooperative.edit", entityId: a.cooperative.id },
      }),
    ).toBe(0);
  });
});

describe("getDocumentUrl", () => {
  async function seeded() {
    const a = await officerWithCooperative("u1", "RC-A");
    const doc = await uploadDocument(a.actor, a.cooperative.id, {
      kind: "BYLAWS",
      body: PDF,
      contentType: "application/pdf",
    });
    return { ...a, doc };
  }

  it("document_url_denied_to_other_cooperatives", async () => {
    const { doc } = await seeded();
    const b = await officerWithCooperative("u2", "RC-B");
    await expect(getDocumentUrl(b.actor, doc.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("gives an ADMIN a signed URL", async () => {
    const { doc } = await seeded();
    const url = await getDocumentUrl(admin, doc.id);
    expect(url).toContain("/api/dev-storage/cooperatives/");
    expect(url).toContain("sig=");
  });

  it("gives the owning officer a signed URL", async () => {
    const { actor, doc } = await seeded();
    expect(await getDocumentUrl(actor, doc.id)).toContain("sig=");
  });

  it("forbids a farmer, a buyer and a board admin", async () => {
    const { cooperative, doc } = await seeded();
    for (const role of ["FARMER", "BUYER", "BOARD_ADMIN"] as const) {
      const actor: Actor = {
        userId: "x",
        role,
        cooperativeId: role === "FARMER" ? cooperative.id : null,
        twoFactorEnabled: false,
      };
      await expect(getDocumentUrl(actor, doc.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe("views", () => {
  it("never include recipientCode, and only the admin view has reviewNote and waiting days", async () => {
    const { cooperative } = await officerWithCooperative("u1", "RC-1");
    const row = await prisma.cooperative.update({
      where: { id: cooperative.id },
      data: {
        reviewNote: "Needs a clearer scan",
        submittedAt: new Date(Date.now() - 3 * 86_400_000),
        recipientCode: "RCP_secret",
        accountName: "Zaria Maize",
      },
    });
    const officer = toOfficerCooperative(row);
    const adminView = toAdminCooperative(row, []);
    expect(JSON.stringify(officer)).not.toContain("RCP_secret");
    expect(JSON.stringify(adminView)).not.toContain("RCP_secret");
    expect(officer).not.toHaveProperty("recipientCode");
    expect(officer).not.toHaveProperty("reviewNote");
    expect(officer).not.toHaveProperty("waitingDays");
    expect(adminView).toMatchObject({
      reviewNote: "Needs a clearer scan",
      waitingDays: 3,
    });
  });
});
