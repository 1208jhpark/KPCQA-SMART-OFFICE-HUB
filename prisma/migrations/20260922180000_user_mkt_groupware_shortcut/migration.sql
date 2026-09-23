-- 마케팅 그룹웨어 바로가기: 사용자별 개인 설정
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mkt_groupware_shortcut_url" TEXT NOT NULL DEFAULT '';
