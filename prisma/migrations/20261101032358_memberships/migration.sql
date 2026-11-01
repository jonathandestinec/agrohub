-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FARMER', 'OFFICER', 'BUYER', 'ADMIN', 'BOARD_ADMIN');

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "cooperativeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_userId_idx" ON "membership"("userId");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written constraints (Prisma cannot express these).

-- No duplicate (userId, role, cooperativeId); NULLs compare equal so a null-cooperative
-- role such as ADMIN cannot be granted twice either.
ALTER TABLE "membership"
  ADD CONSTRAINT "membership_user_role_cooperative_key"
  UNIQUE NULLS NOT DISTINCT ("userId", "role", "cooperativeId");

-- A farmer has exactly one cooperative.
CREATE UNIQUE INDEX "membership_one_farmer_per_user"
  ON "membership" ("userId") WHERE "role" = 'FARMER';

-- An officer belongs to one cooperative.
CREATE UNIQUE INDEX "membership_one_officer_per_user"
  ON "membership" ("userId") WHERE "role" = 'OFFICER';
