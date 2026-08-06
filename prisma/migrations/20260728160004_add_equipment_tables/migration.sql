-- Equipment + CalibrationHistory 테이블 껍데기
-- 기존 환경은 db push로 이미 있을 수 있음 → IF NOT EXISTS / 제약 존재 가드

-- CreateTable
CREATE TABLE IF NOT EXISTS "Equipment" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "serial_no" TEXT,
    "brand" TEXT,
    "asset_no" TEXT NOT NULL,
    "purpose" TEXT,
    "spec_summary" TEXT,
    "full_spec" TEXT,
    "thumbnail_url" TEXT,
    "gallery_urls" JSONB DEFAULT '[]',
    "department" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "purchase_date" TIMESTAMP(3),
    "replace_cycle_mo" INTEGER,
    "last_replace_date" TIMESTAMP(3),
    "next_replace_date" TIMESTAMP(3),
    "calib_cycle_mo" INTEGER NOT NULL DEFAULT 12,
    "next_calib_date" TIMESTAMP(3),
    "calib_memo" TEXT,
    "status" TEXT NOT NULL DEFAULT '정상',
    "manual_url" TEXT,
    "cert_url" TEXT,
    "etc_url" TEXT,
    "etc_memo" TEXT,
    "creator_name" TEXT,
    "creator_dept" TEXT,
    "creator_email" TEXT,
    "updated_by_name" TEXT,
    "updated_by_dept" TEXT,
    "updated_by_email" TEXT,
    "archived_at" TIMESTAMP(3),
    "archived_by_name" TEXT,
    "archived_by_dept" TEXT,
    "archived_by_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CalibrationHistory" (
    "id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "calib_request_date" TEXT,
    "calib_date" TIMESTAMP(3) NOT NULL,
    "agency" TEXT NOT NULL,
    "content" TEXT,
    "result" TEXT NOT NULL,
    "cost" DOUBLE PRECISION DEFAULT 0,
    "estimate_url" TEXT,
    "cert_file_url" TEXT,
    "receipt_url" TEXT,
    "next_calib_date" TIMESTAMP(3),
    "memo" TEXT,
    "creator_name" TEXT,
    "creator_dept" TEXT,
    "creator_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalibrationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Equipment_asset_no_key" ON "Equipment"("asset_no");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalibrationHistory_equipment_id_fkey'
  ) THEN
    ALTER TABLE "CalibrationHistory"
      ADD CONSTRAINT "CalibrationHistory_equipment_id_fkey"
      FOREIGN KEY ("equipment_id") REFERENCES "Equipment"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
