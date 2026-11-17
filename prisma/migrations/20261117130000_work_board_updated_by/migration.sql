-- ScheduleWorkBoardItem last editor
ALTER TABLE "ScheduleWorkBoardItem" ADD COLUMN IF NOT EXISTS "updated_by_name" TEXT;
ALTER TABLE "ScheduleWorkBoardItem" ADD COLUMN IF NOT EXISTS "updated_by_email" TEXT;
