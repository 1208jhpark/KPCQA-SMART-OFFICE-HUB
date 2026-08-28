-- 명판 신청폼: 인증번호 / 유효기간 필드 사용 여부 (인증별 설정)
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "useCertNumber" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "useValidPeriod" BOOLEAN NOT NULL DEFAULT true;

-- 기존 하드코딩 동작과 동일하게 시드 기본값 보정
UPDATE "ProductionCertMaster" SET "useCertNumber" = false WHERE "certId" IN ('GSEED', 'BF');
UPDATE "ProductionCertMaster" SET "useValidPeriod" = false WHERE "certId" = 'ISO';
