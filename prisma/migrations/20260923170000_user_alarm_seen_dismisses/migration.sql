-- 홈 알람 확인(회색) · ✕ 삭제 — 재로그인 유지용
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "alarm_seen" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "alarm_dismisses" JSONB NOT NULL DEFAULT '{}';
