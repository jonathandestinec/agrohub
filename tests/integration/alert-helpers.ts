import type { Notification } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// A person's alert rows, newest first (id breaks ties between rows saved in the same millisecond).
export async function alertsFor(userId: string): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function alertKinds(userId: string): Promise<string[]> {
  return (await alertsFor(userId)).map((row) => row.kind);
}
