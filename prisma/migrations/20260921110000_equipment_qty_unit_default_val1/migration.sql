-- qty_unit 기본값을 마스터 코드 VAL_1(EA)에 맞춤
ALTER TABLE "Equipment" ALTER COLUMN "qty_unit" SET DEFAULT 'VAL_1';

-- 레거시 기본값 EA → VAL_1 (명시적으로 다른 단위를 둔 행은 유지)
UPDATE "Equipment" SET "qty_unit" = 'VAL_1' WHERE "qty_unit" = 'EA';
