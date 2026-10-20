-- 공유 일정 상세 필드 (위치 / 시간 / 참석자)
ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "location" TEXT DEFAULT '';
ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "time_text" TEXT DEFAULT '';
ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "attendees" TEXT DEFAULT '';
