-- 명함 발주 메일 바로가기 기본 경로
ALTER TABLE "SystemConfig" ALTER COLUMN "bc_mail_shortcut_url" SET DEFAULT 'https://ep.kpcqa.or.kr/mail2/writeMailView.do';
UPDATE "SystemConfig"
SET "bc_mail_shortcut_url" = 'https://ep.kpcqa.or.kr/mail2/writeMailView.do'
WHERE COALESCE(TRIM("bc_mail_shortcut_url"), '') = '';
