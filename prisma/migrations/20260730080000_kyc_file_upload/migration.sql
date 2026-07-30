-- Existing rows reference an external fileUrl that no longer has any meaning once documents are
-- stored on local disk (there is no source file to backfill fileName/mimeType/fileSize from) -
-- clearing the table is safe here since it only ever held demo/seed data, and the reviewed
-- status on any of those rows can't be reconstructed from a URL anyway.
TRUNCATE TABLE "kyc_documents";

-- AlterTable
ALTER TABLE "kyc_documents" DROP COLUMN "fileUrl",
ADD COLUMN     "fileName" TEXT NOT NULL,
ADD COLUMN     "fileSize" INTEGER NOT NULL,
ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "originalFileName" TEXT NOT NULL;

