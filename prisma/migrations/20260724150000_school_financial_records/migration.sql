-- CreateEnum
CREATE TYPE "SchoolTransactionType" AS ENUM ('CHARGE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "SchoolTransactionStatus" AS ENUM ('PENDING', 'PENDING_APPROVAL', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "schoolId" TEXT;

-- CreateTable
CREATE TABLE "school_financial_records" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "program" TEXT,
    "currency" TEXT NOT NULL,
    "totalBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_financial_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_transactions" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "type" "SchoolTransactionType" NOT NULL,
    "status" "SchoolTransactionStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_financial_records_institutionId_idx" ON "school_financial_records"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "school_financial_records_institutionId_schoolId_key" ON "school_financial_records"("institutionId", "schoolId");

-- CreateIndex
CREATE INDEX "school_transactions_recordId_idx" ON "school_transactions"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "students_institutionId_schoolId_key" ON "students"("institutionId", "schoolId");

-- AddForeignKey
ALTER TABLE "school_financial_records" ADD CONSTRAINT "school_financial_records_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_transactions" ADD CONSTRAINT "school_transactions_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "school_financial_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

