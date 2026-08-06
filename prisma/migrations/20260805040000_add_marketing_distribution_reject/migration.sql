-- AlterTable
ALTER TABLE "MarketingDistribution" ADD COLUMN IF NOT EXISTS "reject_reason" TEXT;
ALTER TABLE "MarketingDistribution" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
