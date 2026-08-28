-- 제본 신청폼: 인증별 판형/표지/본문 기본값 및 표지 활성화
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "jebonDefaultSizeType" TEXT NOT NULL DEFAULT 'A4';
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "useJebonCover" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "jebonCoverColor" TEXT NOT NULL DEFAULT '컬러';
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "jebonCoverPageCount" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "jebonInnerColor" TEXT NOT NULL DEFAULT '흑백';

-- 제본 인증 기본값 일괄 반영
UPDATE "ProductionCertMaster"
SET
  "jebonDefaultSizeType" = 'A4',
  "useJebonCover" = true,
  "jebonCoverColor" = '컬러',
  "jebonCoverPageCount" = '1',
  "jebonInnerColor" = '흑백'
WHERE "type" = 'JEBON';
