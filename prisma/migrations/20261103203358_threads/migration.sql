-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('BUYER_COOPERATIVE', 'FARMER_COOPERATIVE');

-- CreateEnum
CREATE TYPE "MessageSide" AS ENUM ('BUYER', 'COOPERATIVE', 'FARMER', 'ADMIN');

-- CreateTable
CREATE TABLE "thread" (
    "id" TEXT NOT NULL,
    "kind" "ThreadKind" NOT NULL,
    "lotId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "counterpartUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "side" "MessageSide" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_cooperativeId_lastMessageAt_idx" ON "thread"("cooperativeId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "thread_counterpartUserId_lastMessageAt_idx" ON "thread"("counterpartUserId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "thread_lotId_kind_counterpartUserId_key" ON "thread"("lotId", "kind", "counterpartUserId");

-- CreateIndex
CREATE INDEX "message_threadId_createdAt_idx" ON "message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "message_authorUserId_createdAt_idx" ON "message"("authorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_counterpartUserId_fkey" FOREIGN KEY ("counterpartUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "thread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
