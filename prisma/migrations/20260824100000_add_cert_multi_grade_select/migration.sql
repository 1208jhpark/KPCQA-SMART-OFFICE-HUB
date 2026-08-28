-- 신청폼 등급 입력 방식: 체크박스 복수 vs 셀렉트 단일
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "useMultiGradeSelect" BOOLEAN NOT NULL DEFAULT false;

-- 기존 ISO 하드코딩 동작과 동일하게 보정
UPDATE "ProductionCertMaster" SET "useMultiGradeSelect" = true WHERE "certId" = 'ISO';
