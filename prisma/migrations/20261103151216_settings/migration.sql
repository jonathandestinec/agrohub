-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);
