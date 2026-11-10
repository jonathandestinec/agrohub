-- CreateTable
CREATE TABLE "reconciliation_issue" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" TEXT,
    "detail" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_issue_resolvedAt_createdAt_idx" ON "reconciliation_issue"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_issue_kind_reference_key" ON "reconciliation_issue"("kind", "reference");
