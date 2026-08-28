-- 명함 1통당 장수 (업체 교체 시 관리자가 변경)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "bc_sheets_per_pack" INTEGER NOT NULL DEFAULT 200;
