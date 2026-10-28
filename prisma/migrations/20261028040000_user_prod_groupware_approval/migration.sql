-- 제작물 검수(사무문구) — 개인 그룹웨어 결재 기안 바로가기
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "prod_groupware_approval_url" TEXT NOT NULL DEFAULT '';
