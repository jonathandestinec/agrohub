-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('CROP', 'UNIT');

-- CreateEnum
CREATE TYPE "CatalogRequestStatus" AS ENUM ('WITH_OFFICER', 'FORWARDED', 'DECLINED', 'APPROVED');

-- CreateTable
CREATE TABLE "catalog_request" (
    "id" TEXT NOT NULL,
    "kind" "CatalogKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "CatalogRequestStatus" NOT NULL DEFAULT 'WITH_OFFICER',
    "declineReason" TEXT,
    "declinedBy" TEXT,
    "resolvedItemId" TEXT,
    "forwardedByUserId" TEXT,
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_request_cooperativeId_status_idx" ON "catalog_request"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "catalog_request_status_kind_nameKey_idx" ON "catalog_request"("status", "kind", "nameKey");

-- AddForeignKey
ALTER TABLE "catalog_request" ADD CONSTRAINT "catalog_request_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
