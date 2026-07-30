-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "preferredCurrency" TEXT NOT NULL DEFAULT 'RWF';

-- AlterTable
ALTER TABLE "school_transactions" ADD COLUMN     "convertedAmount" DECIMAL(14,2),
ADD COLUMN     "feeAmount" DECIMAL(14,2),
ADD COLUMN     "fxRate" DECIMAL(18,8),
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "sendCurrency" TEXT;

