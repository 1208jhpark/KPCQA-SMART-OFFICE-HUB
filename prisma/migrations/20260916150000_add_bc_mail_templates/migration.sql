-- 명함 외주 메일 제목/본문 양식 (SystemConfig)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "bc_mail_subject_template" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "bc_mail_body_template" TEXT NOT NULL DEFAULT '';
