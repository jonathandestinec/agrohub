import { describe, expect, it } from "vitest";
import type { NameChangeRequest } from "@/generated/prisma/client";
import { toOwnNameChange } from "@/modules/name-changes/views";

const row: NameChangeRequest = {
  id: "ncr-1",
  subjectType: "USER",
  subjectId: "u-requester-77",
  fromName: "Amina Bello",
  toName: "Amina Musa",
  reason: "Married in October 2026",
  documentKind: "AFFIDAVIT",
  storageKey: "name-changes/USER/u-requester-77/secretkey123",
  contentType: "application/pdf",
  sizeBytes: 100,
  status: "PENDING",
  requestedByUserId: "u-requester-77",
  decidedByUserId: null,
  rejectionReason: null,
  decidedAt: null,
  createdAt: new Date("2026-11-04T10:00:00Z"),
};

describe("toOwnNameChange", () => {
  it("never carries the storage key or the requester id", () => {
    const json = JSON.stringify(toOwnNameChange(row));
    expect(json).not.toContain("secretkey123");
    expect(json).not.toContain("u-requester-77");
  });

  it("keeps the names, status and dates", () => {
    expect(toOwnNameChange(row)).toEqual({
      id: "ncr-1",
      subjectType: "USER",
      fromName: "Amina Bello",
      toName: "Amina Musa",
      documentKind: "AFFIDAVIT",
      status: "PENDING",
      rejectionReason: null,
      createdAt: "2026-11-04T10:00:00.000Z",
      decidedAt: null,
    });
  });
});
