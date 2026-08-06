-- AlterTable
ALTER TABLE "MarketingDistribution" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONFIRMED';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingDistribution_status_idx" ON "MarketingDistribution"("status");
