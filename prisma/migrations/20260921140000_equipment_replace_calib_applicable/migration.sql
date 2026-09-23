-- 교체/검교정 대상 여부 (false = 대상 아님)
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "replace_applicable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "calib_applicable" BOOLEAN NOT NULL DEFAULT true;
