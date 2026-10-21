-- 일정 서비스 업무 보드
CREATE TABLE IF NOT EXISTS "ScheduleWorkBoardItem" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "unit_name" TEXT,
  "title" TEXT NOT NULL,
  "note" TEXT DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "due_date" TEXT,
  "assignee_name" TEXT,
  "assignee_email" TEXT,
  "creator_name" TEXT,
  "creator_email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleWorkBoardItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardItem_unit_id_status_sort_order_idx"
  ON "ScheduleWorkBoardItem"("unit_id", "status", "sort_order");
