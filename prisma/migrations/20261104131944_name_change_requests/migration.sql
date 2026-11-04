-- CreateEnum
CREATE TYPE "NameSubjectType" AS ENUM ('USER', 'COOPERATIVE');

-- CreateEnum
CREATE TYPE "NameChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "NameDocumentKind" AS ENUM ('AFFIDAVIT', 'MARRIAGE_CERTIFICATE', 'PUBLIC_NOTICE', 'AMENDED_REGISTRATION_CERTIFICATE');

-- CreateTable
CREATE TABLE "name_change_request" (
    "id" TEXT NOT NULL,
    "subjectType" "NameSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "documentKind" "NameDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "NameChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "rejectionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "name_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "name_change_request_status_createdAt_idx" ON "name_change_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "name_change_request_subjectType_subjectId_idx" ON "name_change_request"("subjectType", "subjectId");

-- One PENDING request per subject (see the schema comment).
CREATE UNIQUE INDEX "name_change_request_one_pending_key" ON "name_change_request" ("subjectType", "subjectId") WHERE "status" = 'PENDING';
