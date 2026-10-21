-- 업무 보드: 일자별 공유 프로젝트
ALTER TABLE "ScheduleWorkBoardItem"
  ADD COLUMN IF NOT EXISTS "board_date" TEXT;

CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardItem_unit_id_board_date_idx"
  ON "ScheduleWorkBoardItem"("unit_id", "board_date");
