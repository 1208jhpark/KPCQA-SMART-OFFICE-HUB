-- 제작물 검수 메일: 사용자별 개인 바로가기·제목·본문
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prod_mail_shortcut_url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prod_mail_subject_template" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prod_mail_body_template" TEXT NOT NULL DEFAULT '';
