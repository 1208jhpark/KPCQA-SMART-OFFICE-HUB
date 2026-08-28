-- 그룹웨어 메일 바로가기 경로 (업체 메일 발송 팝업)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "bc_mail_shortcut_url" TEXT NOT NULL DEFAULT '';
