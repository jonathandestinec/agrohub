-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID_HELD', 'PREPARING', 'DELIVERED_MARKED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIALIZED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('LATE_PAYMENT', 'BUYER_CANCEL', 'COOPERATIVE_CANCEL', 'SHORTFALL', 'ADMIN_DECISION');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('PAYSTACK_BALANCE', 'HELD', 'COOPERATIVE_PAYABLE', 'FARMER_PAYABLE', 'PLATFORM_FEE', 'PAYSTACK_FEES', 'REFUND_PAYABLE');

-- AlterEnum
ALTER TYPE "OfferStatus" ADD VALUE 'ORDERED';

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "offerId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitKobo" INTEGER NOT NULL,
    "cutBps" INTEGER NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "deliveryKobo" BIGINT NOT NULL DEFAULT 0,
    "deliveryQuoteId" TEXT,
    "totalKobo" BIGINT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "cancelReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "deliveryDate" DATE,
    "deliveredQuantity" INTEGER,
    "deliveredMarkedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "countsTowardStock" BOOLEAN NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZED',
    "paystackTransactionId" TEXT,
    "feesKobo" BIGINT,
    "channel" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paystack_event" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paystack_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "recipientRef" TEXT,
    "amountKobo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "paystackRefundId" TEXT,
    "requestedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_quote" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "cooperativeId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "note" TEXT,
    "quotedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_deliveryQuoteId_key" ON "order"("deliveryQuoteId");

-- CreateIndex
CREATE INDEX "order_lotId_status_idx" ON "order"("lotId", "status");

-- CreateIndex
CREATE INDEX "order_cooperativeId_status_idx" ON "order"("cooperativeId", "status");

-- CreateIndex
CREATE INDEX "order_buyerUserId_createdAt_idx" ON "order"("buyerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "order_status_paidAt_idx" ON "order"("status", "paidAt");

-- CreateIndex
CREATE INDEX "order_status_deliveredMarkedAt_idx" ON "order"("status", "deliveredMarkedAt");

-- CreateIndex
CREATE INDEX "order_offerId_idx" ON "order"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_orderId_key" ON "stock_reservation"("orderId");

-- CreateIndex
CREATE INDEX "stock_reservation_lotId_expiresAt_idx" ON "stock_reservation"("lotId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reference_key" ON "payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_paystackTransactionId_key" ON "payment"("paystackTransactionId");

-- CreateIndex
CREATE INDEX "payment_orderId_idx" ON "payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "paystack_event_eventKey_key" ON "paystack_event"("eventKey");

-- CreateIndex
CREATE INDEX "ledger_entry_orderId_idx" ON "ledger_entry"("orderId");

-- CreateIndex
CREATE INDEX "ledger_entry_groupId_idx" ON "ledger_entry"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_paystackRefundId_key" ON "refund"("paystackRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_orderId_purpose_key" ON "refund"("orderId", "purpose");

-- CreateIndex
CREATE INDEX "delivery_quote_lotId_buyerUserId_idx" ON "delivery_quote"("lotId", "buyerUserId");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_cooperativeId_fkey" FOREIGN KEY ("cooperativeId") REFERENCES "cooperative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_deliveryQuoteId_fkey" FOREIGN KEY ("deliveryQuoteId") REFERENCES "delivery_quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quote" ADD CONSTRAINT "delivery_quote_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ledger is append-only, like audit_log: refuse UPDATE, DELETE and TRUNCATE, even with raw SQL.
CREATE FUNCTION ledger_entry_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_no_update_delete
  BEFORE UPDATE OR DELETE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_reject_mutation();

CREATE TRIGGER ledger_entry_no_truncate
  BEFORE TRUNCATE ON "ledger_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entry_reject_mutation();
