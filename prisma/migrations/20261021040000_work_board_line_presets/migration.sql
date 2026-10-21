CREATE TABLE IF NOT EXISTS "ScheduleWorkBoardLinePreset" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "unit_name" TEXT,
  "area" TEXT NOT NULL,
  "assignee_name" TEXT NOT NULL DEFAULT '',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "updated_by_name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleWorkBoardLinePreset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduleWorkBoardLinePreset_unit_id_sort_order_idx"
  ON "ScheduleWorkBoardLinePreset"("unit_id", "sort_order");
