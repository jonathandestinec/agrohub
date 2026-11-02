import { prisma } from "@/lib/db";

// Addresses of every user with an ACTIVE ADMIN membership, one per user.
export async function listActiveAdminEmails(): Promise<string[]> {
  const admins = await prisma.membership.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { user: { select: { email: true } } },
    distinct: ["userId"],
  });
  return admins.map((admin) => admin.user.email);
}
