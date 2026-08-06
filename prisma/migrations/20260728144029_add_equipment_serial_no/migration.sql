-- Equipment.serial_no (시리얼번호)
-- 기존 환경은 db push로만 반영된 경우가 있어, migrate deploy 환경에서도 안전하게 추가합니다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'Equipment'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Equipment'
      AND column_name = 'serial_no'
  ) THEN
    ALTER TABLE "Equipment" ADD COLUMN "serial_no" TEXT;
  END IF;
END $$;
