-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentIntentId" TEXT;

-- CreateTable
CREATE TABLE "OrderCancellation" (
    "id" TEXT NOT NULL,
    "duffelCancellationId" TEXT NOT NULL,
    "orderDuffelId" TEXT NOT NULL,
    "refundAmount" TEXT,
    "refundCurrency" TEXT,
    "refundTo" TEXT,
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderCancellation_duffelCancellationId_key" ON "OrderCancellation"("duffelCancellationId");

-- CreateIndex
CREATE INDEX "OrderCancellation_orderDuffelId_idx" ON "OrderCancellation"("orderDuffelId");

-- AddForeignKey
ALTER TABLE "OrderCancellation" ADD CONSTRAINT "OrderCancellation_orderDuffelId_fkey" FOREIGN KEY ("orderDuffelId") REFERENCES "Order"("duffelId") ON DELETE CASCADE ON UPDATE CASCADE;
