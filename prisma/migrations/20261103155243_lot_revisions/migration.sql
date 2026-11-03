-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "lot_revision" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "askKobo" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "floorKobo" INTEGER NOT NULL,
    "note" TEXT,
    "deviation" "Deviation",
    "status" "RevisionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "screenedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "lot_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_revision_lotId_status_idx" ON "lot_revision"("lotId", "status");

-- AddForeignKey
ALTER TABLE "lot_revision" ADD CONSTRAINT "lot_revision_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
