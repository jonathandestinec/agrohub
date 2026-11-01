-- CreateTable
CREATE TABLE "farmer_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "farmSizeHectares" DECIMAL(8,2) NOT NULL,
    "crops" TEXT[],
    "state" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "recipientCode" TEXT,
    "accountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farmer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farmer_profile_userId_key" ON "farmer_profile"("userId");

-- CreateIndex
CREATE INDEX "farmer_profile_cooperativeId_idx" ON "farmer_profile"("cooperativeId");

-- AddForeignKey
ALTER TABLE "farmer_profile" ADD CONSTRAINT "farmer_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farmer_profile" ADD CONSTRAINT "farmer_profile_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

