-- 공유 일정 테이블 (개발 PC에서 db push로만 생긴 경우 대비) + 상세 필드
CREATE TABLE IF NOT EXISTS "MarketingDeptCalendarEvent" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "unit_name" TEXT,
  "title" TEXT NOT NULL,
  "note" TEXT DEFAULT '',
  "location" TEXT DEFAULT '',
  "time_text" TEXT DEFAULT '',
  "attendees" TEXT DEFAULT '',
  "start_date" TEXT NOT NULL,
  "end_date" TEXT,
  "all_day" BOOLEAN NOT NULL DEFAULT true,
  "color" TEXT DEFAULT '#4f46e5',
  "creator_name" TEXT,
  "creator_dept" TEXT,
  "creator_email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingDeptCalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MarketingDeptCalendarEvent_unit_id_start_date_idx"
  ON "MarketingDeptCalendarEvent"("unit_id", "start_date");

ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "location" TEXT DEFAULT '';
ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "time_text" TEXT DEFAULT '';
ALTER TABLE "MarketingDeptCalendarEvent" ADD COLUMN IF NOT EXISTS "attendees" TEXT DEFAULT '';
