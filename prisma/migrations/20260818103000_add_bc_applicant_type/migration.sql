-- 명함 신청 주체 (본인 / 관리자대행)
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "applicantType" TEXT NOT NULL DEFAULT '본인';
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "applicantName" TEXT;
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "applicantEmail" TEXT;
