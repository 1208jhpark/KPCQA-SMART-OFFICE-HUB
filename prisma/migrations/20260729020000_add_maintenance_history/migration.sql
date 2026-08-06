-- MaintenanceHistory (구매/유지보수 이력)
-- 로컬은 db push로 이미 있을 수 있음 → IF NOT EXISTS / FK 가드

CREATE TABLE IF NOT EXISTS "MaintenanceHistory" (
    "id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendor" TEXT,
    "content" TEXT,
    "cost" DOUBLE PRECISION DEFAULT 0,
    "receipt_url" TEXT,
    "memo" TEXT,
    "creator_name" TEXT,
    "creator_dept" TEXT,
    "creator_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaintenanceHistory_equipment_id_idx" ON "MaintenanceHistory"("equipment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MaintenanceHistory_equipment_id_fkey'
  ) THEN
    ALTER TABLE "MaintenanceHistory"
      ADD CONSTRAINT "MaintenanceHistory_equipment_id_fkey"
      FOREIGN KEY ("equipment_id") REFERENCES "Equipment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
