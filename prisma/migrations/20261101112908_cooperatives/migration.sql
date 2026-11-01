-- CreateEnum
CREATE TYPE "CooperativeStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('REGISTRATION_CERTIFICATE', 'BYLAWS', 'OFFICER_LIST');

-- CreateTable
CREATE TABLE "cooperative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "status" "CooperativeStatus" NOT NULL DEFAULT 'PENDING',
    "certificateExpiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "recipientCode" TEXT,
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cooperative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooperative_document" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cooperative_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cooperative_registrationNumber_key" ON "cooperative"("registrationNumber");

-- CreateIndex
CREATE INDEX "cooperative_document_cooperativeId_idx" ON "cooperative_document"("cooperativeId");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooperative_document" ADD CONSTRAINT "cooperative_document_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
