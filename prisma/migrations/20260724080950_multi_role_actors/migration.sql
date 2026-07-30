/*
  Warnings:

  - You are about to drop the column `studentId` on the `refresh_tokens` table. All the data in the column will be lost.
  - Added the required column `role` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subjectId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('STUDENT', 'INSTITUTION_ADMIN', 'PLATFORM_ADMIN');

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_studentId_fkey";

-- DropIndex
DROP INDEX "refresh_tokens_studentId_idx";

-- Sessions are disposable - clear existing rows so the new NOT NULL columns below can be
-- added without a default. Any logged-in users simply need to log in again.
TRUNCATE TABLE "refresh_tokens";

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "studentId",
ADD COLUMN     "role" "ActorRole" NOT NULL,
ADD COLUMN     "subjectId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institution_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutions_contactEmail_key" ON "institutions"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "institution_admins_email_key" ON "institution_admins"("email");

-- CreateIndex
CREATE INDEX "institution_admins_institutionId_idx" ON "institution_admins"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_subjectId_idx" ON "refresh_tokens"("subjectId");

-- CreateIndex
CREATE INDEX "students_institutionId_idx" ON "students"("institutionId");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_admins" ADD CONSTRAINT "institution_admins_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
