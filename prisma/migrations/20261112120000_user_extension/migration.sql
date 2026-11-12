-- /admin/users 내선번호 (스키마에만 있고 마이그레이션이 빠져 로그인 P2022 유발)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extension" TEXT NOT NULL DEFAULT '';
