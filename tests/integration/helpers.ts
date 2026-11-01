import { randomUUID } from "node:crypto";
import type { Cooperative, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// A cooperative with a unique registration number on every call.
export async function createTestCooperative(
  overrides: Partial<Omit<Cooperative, "id" | "createdAt">> = {},
): Promise<Cooperative> {
  return prisma.cooperative.create({
    data: {
      name: "Test Cooperative",
      registrationNumber: `RC-${randomUUID()}`,
      state: "Kaduna",
      lga: "Zaria",
      certificateExpiresAt: new Date("2030-01-01T00:00:00Z"),
      ...overrides,
    },
  });
}

export async function createTestUser(
  overrides: Partial<Pick<User, "id" | "name" | "email" | "phone">> = {},
): Promise<User> {
  const id = overrides.id ?? `u-${randomUUID()}`;
  return prisma.user.create({
    data: {
      id,
      name: `User ${id}`,
      email: `${id}@example.com`,
      phone: "+2348012345678",
      consentAcceptedAt: new Date(),
      ...overrides,
    },
  });
}

// Children before parents: documents and memberships, then cooperatives, then users.
export async function cleanDatabase(): Promise<void> {
  await prisma.bankChangeRequest.deleteMany();
  await prisma.inviteLink.deleteMany();
  await prisma.cooperativeDocument.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.cooperative.deleteMany();
  await prisma.user.deleteMany();
}
