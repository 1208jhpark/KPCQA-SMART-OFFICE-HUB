-- 외주업체 자유 기재 비고
ALTER TABLE "OutsourcingVendor" ADD COLUMN IF NOT EXISTS "memo" TEXT NOT NULL DEFAULT '';
