-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('RELEASE', 'REFUND_ALL', 'REFUND_UNITS', 'NOTE');

-- CreateTable
CREATE TABLE "dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedByUserId" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "unitsRefunded" INTEGER,
    "decisionNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_status_createdAt_idx" ON "dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "dispute_orderId_idx" ON "dispute"("orderId");

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
