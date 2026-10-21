-- 부서 공용 용도별 색상
CREATE TABLE IF NOT EXISTS "ScheduleDeptColorPurpose" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "unit_name" TEXT,
  "label" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#7baaf7',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "updated_by_name" TEXT,
  "updated_by_email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleDeptColorPurpose_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduleDeptColorPurpose_unit_id_sort_order_idx"
  ON "ScheduleDeptColorPurpose"("unit_id", "sort_order");

-- 일정에 용도 색상 연결
ALTER TABLE "MarketingDeptCalendarEvent"
  ADD COLUMN IF NOT EXISTS "color_purpose_id" TEXT;

CREATE INDEX IF NOT EXISTS "MarketingDeptCalendarEvent_color_purpose_id_idx"
  ON "MarketingDeptCalendarEvent"("color_purpose_id");
