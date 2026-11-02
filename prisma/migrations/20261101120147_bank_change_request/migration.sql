-- CreateEnum
CREATE TYPE "BankOwnerType" AS ENUM ('COOPERATIVE', 'FARMER');

-- AlterTable
ALTER TABLE "cooperative" ADD COLUMN     "bankName" TEXT;

-- CreateTable
CREATE TABLE "bank_change_request" (
    "id" TEXT NOT NULL,
    "ownerType" "BankOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "newRecipientCode" TEXT NOT NULL,
    "newAccountName" TEXT NOT NULL,
    "newBankName" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "confirmToken" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_change_request_confirmToken_key" ON "bank_change_request"("confirmToken");

-- CreateIndex
CREATE INDEX "bank_change_request_ownerType_ownerId_idx" ON "bank_change_request"("ownerType", "ownerId");
