-- CreateTable
CREATE TABLE "price_point" (
    "id" TEXT NOT NULL,
    "cropId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "priceKobo" INTEGER NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_point_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_point_weekOf_idx" ON "price_point"("weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "price_point_cropId_unitId_marketKey_weekOf_key" ON "price_point"("cropId", "unitId", "marketKey", "weekOf");

-- AddForeignKey
ALTER TABLE "price_point" ADD CONSTRAINT "price_point_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_point" ADD CONSTRAINT "price_point_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
