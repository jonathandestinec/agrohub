-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REMOVED', 'LEFT');

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "phoneConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: a farmer/officer slot is held only by PENDING or ACTIVE memberships,
-- so a farmer who has LEFT (or was REMOVED) can join another cooperative.
-- Same names as before; membership_user_role_cooperative_key is untouched.
DROP INDEX "membership_one_farmer_per_user";
DROP INDEX "membership_one_officer_per_user";

CREATE UNIQUE INDEX "membership_one_farmer_per_user"
  ON "membership" ("userId") WHERE "role" = 'FARMER' AND "status" IN ('PENDING', 'ACTIVE');

CREATE UNIQUE INDEX "membership_one_officer_per_user"
  ON "membership" ("userId") WHERE "role" = 'OFFICER' AND "status" IN ('PENDING', 'ACTIVE');
