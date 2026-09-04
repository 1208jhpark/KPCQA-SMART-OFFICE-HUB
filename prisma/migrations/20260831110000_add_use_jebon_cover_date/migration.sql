-- AlterTable
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "useJebonCoverDate" BOOLEAN NOT NULL DEFAULT true;

-- 일반제본도 표지 일자 양식 기본 제공
UPDATE "ProductionCertMaster"
SET "jebonFormat" = '0000. 0. 0.'
WHERE "certId" = 'NORMAL' AND ("jebonFormat" IS NULL OR "jebonFormat" = '');
