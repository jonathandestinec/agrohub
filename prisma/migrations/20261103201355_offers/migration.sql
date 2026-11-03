-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'AWAITING_FARMER', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "offer" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "offeredKobo" INTEGER NOT NULL,
    "counterKobo" INTEGER,
    "agreedKobo" INTEGER,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "payByAt" TIMESTAMP(3),
    "referredByUserId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offer_lotId_status_idx" ON "offer"("lotId", "status");

-- CreateIndex
CREATE INDEX "offer_cooperativeId_status_idx" ON "offer"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "offer_buyerUserId_createdAt_idx" ON "offer"("buyerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "offer_status_expiresAt_idx" ON "offer"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
