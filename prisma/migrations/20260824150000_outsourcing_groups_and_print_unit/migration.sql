-- SystemConfig: 외주 업무 마스터 그룹 매핑 컬럼
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "outsourcing_vendor_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "outsourcing_item_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "outsourcing_detail1_group" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "outsourcing_detail2_group" TEXT NOT NULL DEFAULT '';

-- ProductionPrintItemMaster: 단위 마스터 코드 연동
ALTER TABLE "ProductionPrintItemMaster" ADD COLUMN IF NOT EXISTS "unitValue" TEXT NOT NULL DEFAULT 'VAL_1';
