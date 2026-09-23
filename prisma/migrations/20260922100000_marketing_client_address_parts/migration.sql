-- AlterTable
ALTER TABLE "MarketingClient" ADD COLUMN IF NOT EXISTS "zip_code" TEXT;
ALTER TABLE "MarketingClient" ADD COLUMN IF NOT EXISTS "address_road" TEXT;
ALTER TABLE "MarketingClient" ADD COLUMN IF NOT EXISTS "address_detail" TEXT;
