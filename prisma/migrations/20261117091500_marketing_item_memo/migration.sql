-- MarketingItem.memo
ALTER TABLE "MarketingItem" ADD COLUMN IF NOT EXISTS "memo" TEXT DEFAULT '';
