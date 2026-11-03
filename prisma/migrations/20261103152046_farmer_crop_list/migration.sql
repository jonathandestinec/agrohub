-- Farmer profile crops move from free text to the board's crop list (Phase 3, Task 3).
-- Existing text that matches a crop's nameKey (trimmed, inner spaces collapsed, lower-cased,
-- as catalog/schema.ts nameKeyOf does) is linked; anything else is dropped with the column.

-- CreateTable
CREATE TABLE "_FarmerCrops" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FarmerCrops_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FarmerCrops_B_index" ON "_FarmerCrops"("B");

-- AddForeignKey
ALTER TABLE "_FarmerCrops" ADD CONSTRAINT "_FarmerCrops_A_fkey" FOREIGN KEY ("A") REFERENCES "crop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FarmerCrops" ADD CONSTRAINT "_FarmerCrops_B_fkey" FOREIGN KEY ("B") REFERENCES "farmer_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill from the free-text column before it is dropped.
INSERT INTO "_FarmerCrops" ("A", "B")
SELECT DISTINCT c."id", p."id"
FROM "farmer_profile" p
CROSS JOIN LATERAL unnest(p."crops") AS t(name)
JOIN "crop" c ON c."nameKey" = lower(regexp_replace(btrim(t.name), '\s+', ' ', 'g'));

-- AlterTable
ALTER TABLE "farmer_profile" DROP COLUMN "crops";
