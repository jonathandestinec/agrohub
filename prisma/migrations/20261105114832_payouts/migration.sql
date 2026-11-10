-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('QUEUED', 'SENT', 'PAID', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PayoutRecipient" AS ENUM ('COOPERATIVE', 'FARMER');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('SENT', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "payout" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recipientType" "PayoutRecipient" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "bankOwnerId" TEXT,
    "part" INTEGER NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "recipientCode" TEXT,
    "reference" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'QUEUED',
    "sendableAt" TIMESTAMP(3) NOT NULL,
    "balanceRefusals" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_attempt" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "transferReference" TEXT NOT NULL,
    "transferCode" TEXT,
    "status" "AttemptStatus" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "payout_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_reference_key" ON "payout"("reference");

-- CreateIndex
CREATE INDEX "payout_status_sendableAt_idx" ON "payout"("status", "sendableAt");

-- CreateIndex
CREATE INDEX "payout_recipientType_recipientId_idx" ON "payout"("recipientType", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_orderId_recipientType_recipientId_part_key" ON "payout"("orderId", "recipientType", "recipientId", "part");

-- CreateIndex
CREATE UNIQUE INDEX "payout_attempt_transferReference_key" ON "payout_attempt"("transferReference");

-- CreateIndex
CREATE INDEX "payout_attempt_status_createdAt_idx" ON "payout_attempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payout_attempt_payoutId_attempt_key" ON "payout_attempt"("payoutId", "attempt");

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempt" ADD CONSTRAINT "payout_attempt_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
