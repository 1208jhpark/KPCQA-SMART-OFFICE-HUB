-- 메일 바로가기 기본 URL 제거 (Edit 권한자가 직접 설정)
ALTER TABLE "SystemConfig" ALTER COLUMN "bc_mail_shortcut_url" SET DEFAULT '';
UPDATE "SystemConfig"
SET "bc_mail_shortcut_url" = ''
WHERE "bc_mail_shortcut_url" IS NULL
   OR TRIM("bc_mail_shortcut_url") = ''
   OR "bc_mail_shortcut_url" = 'https://ep.kpcqa.or.kr/mail2/writeMailView.do';
