-- 제본 신청폼: 부수(수량) 기본값
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "jebonDefaultQuantity" INTEGER NOT NULL DEFAULT 1;

UPDATE "ProductionCertMaster"
SET "jebonDefaultQuantity" = 1
WHERE "type" = 'JEBON';
