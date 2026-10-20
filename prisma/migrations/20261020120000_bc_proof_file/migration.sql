-- AlterTable: BusinessCardRequest 시안 파일·확정 필드
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofFileName" TEXT;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofStoredFileName" TEXT;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofMimeType" TEXT;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofFileSize" INTEGER;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofUploadedAt" TIMESTAMP(3);
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofUploadedBy" TEXT;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofConfirmedAt" TIMESTAMP(3);
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofConfirmedBy" TEXT;
