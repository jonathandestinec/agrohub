-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_run_key_key" ON "job_run"("key");
