-- 업무 보드: 세부분야·담당자·상태 행
ALTER TABLE "ScheduleWorkBoardItem"
  ADD COLUMN IF NOT EXISTS "lines" JSONB;
