-- CreateTable
CREATE TABLE "invite_link" (
    "id" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_link_token_key" ON "invite_link"("token");

-- CreateIndex
CREATE INDEX "invite_link_cooperativeId_idx" ON "invite_link"("cooperativeId");

-- AddForeignKey
ALTER TABLE "invite_link" ADD CONSTRAINT "invite_link_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one open shareable link per cooperative. Prisma's stable schema cannot express a
-- partial index, so this is raw SQL; it is what makes concurrent createInviteLink safe.
CREATE UNIQUE INDEX "invite_link_one_open_shareable_key" ON "invite_link"("cooperativeId") WHERE "email" IS NULL AND "revokedAt" IS NULL;
