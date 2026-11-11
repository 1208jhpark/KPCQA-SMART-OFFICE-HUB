-- AlterTable: 시안 파일 없이 개별메일 확인 후 확정할 수 있도록
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofMailReviewedAt" TIMESTAMP(3);
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "proofMailReviewedBy" TEXT;
