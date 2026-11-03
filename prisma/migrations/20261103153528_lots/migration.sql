-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('PENDING_REVIEW', 'COUNTERED', 'REJECTED', 'LIVE', 'WITHDRAWN', 'EXPIRED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "LotGrade" AS ENUM ('A', 'B', 'C', 'UNGRADED');

-- CreateEnum
CREATE TYPE "Deviation" AS ENUM ('OK', 'HIGH', 'LOW');

-- CreateTable
CREATE TABLE "lot" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "farmerUserId" TEXT NOT NULL,
    "cropId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grade" "LotGrade" NOT NULL,
    "pickupState" TEXT NOT NULL,
    "pickupLga" TEXT NOT NULL,
    "pickupNote" TEXT,
    "askKobo" INTEGER NOT NULL,
    "floorKobo" INTEGER NOT NULL,
    "note" TEXT,
    "deviation" "Deviation",
    "quotedCutBps" INTEGER NOT NULL,
    "quotedFeeBps" INTEGER NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "availableUntil" DATE NOT NULL,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "counterAskKobo" INTEGER,
    "counterMessage" TEXT,
    "rejectionReason" TEXT,
    "screenedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_contribution" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "farmerUserId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "lot_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_photo" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "lot_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_fee_terms" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "cooperativeCutBps" INTEGER NOT NULL,
    "platformFeeBps" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_fee_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_cooperativeId_status_idx" ON "lot"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "lot_status_availableUntil_idx" ON "lot"("status", "availableUntil");

-- CreateIndex
CREATE INDEX "lot_farmerUserId_idx" ON "lot"("farmerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "lot_contribution_lotId_farmerUserId_key" ON "lot_contribution"("lotId", "farmerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "lot_photo_lotId_position_key" ON "lot_photo"("lotId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lot_fee_terms_lotId_key" ON "lot_fee_terms"("lotId");

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_farmerUserId_fkey" FOREIGN KEY ("farmerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_contribution" ADD CONSTRAINT "lot_contribution_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_photo" ADD CONSTRAINT "lot_photo_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_fee_terms" ADD CONSTRAINT "lot_fee_terms_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
