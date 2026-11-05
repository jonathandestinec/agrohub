-- AlterTable
ALTER TABLE "order" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByCooperative" BOOLEAN NOT NULL DEFAULT false;
