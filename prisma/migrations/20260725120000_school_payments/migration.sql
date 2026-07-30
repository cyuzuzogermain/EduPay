-- AlterEnum
ALTER TYPE "SchoolTransactionStatus" ADD VALUE 'INITIATED';

-- AlterTable
ALTER TABLE "school_financial_records" DROP COLUMN "totalBalance";

-- AlterTable
ALTER TABLE "school_transactions" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "school_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_payment_allocations_paymentId_idx" ON "school_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "school_payment_allocations_chargeId_idx" ON "school_payment_allocations"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "school_payment_allocations_paymentId_chargeId_key" ON "school_payment_allocations"("paymentId", "chargeId");

-- AddForeignKey
ALTER TABLE "school_payment_allocations" ADD CONSTRAINT "school_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "school_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_payment_allocations" ADD CONSTRAINT "school_payment_allocations_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "school_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

