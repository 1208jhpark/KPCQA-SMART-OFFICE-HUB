ALTER TABLE "ProductionVendorMaster" ADD COLUMN IF NOT EXISTS "priorityCategory" TEXT NOT NULL DEFAULT '';

-- 시드 업체 기준 우선 품목 백필
UPDATE "ProductionVendorMaster" SET "priorityCategory" = 'SIGN' WHERE "label" = '아트로릭' AND ("priorityCategory" IS NULL OR "priorityCategory" = '');
UPDATE "ProductionVendorMaster" SET "priorityCategory" = 'JEBON' WHERE "label" = '한생미디어' AND ("priorityCategory" IS NULL OR "priorityCategory" = '');
UPDATE "ProductionVendorMaster" SET "priorityCategory" = 'OFFICE_SUPPLIES' WHERE "label" = '드림디포' AND ("priorityCategory" IS NULL OR "priorityCategory" = '');
