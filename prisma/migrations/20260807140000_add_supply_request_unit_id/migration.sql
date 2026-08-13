-- SupplyRequest.unit_id: 조직 스코프를 이름 스냅샷이 아닌 OrgUnit FK로 고정
ALTER TABLE "SupplyRequest" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;

-- 1) 신청자 User.unit_id로 백필
UPDATE "SupplyRequest" AS sr
SET "unit_id" = u."unit_id"
FROM "User" AS u
WHERE sr."unit_id" IS NULL
  AND u.email = sr."user_email"
  AND u."unit_id" IS NOT NULL;

-- 2) 남은 행: dept_name ↔ OrgUnit.unit_name (동명 조직 1개일 때만)
UPDATE "SupplyRequest" AS sr
SET "unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id
  FROM "OrgUnit" AS ou
  WHERE ou."is_deleted" = false
    AND ou."is_active" = true
  GROUP BY ou."unit_name"
  HAVING COUNT(*) = 1
) AS matched
WHERE sr."unit_id" IS NULL
  AND sr."dept_name" = matched."unit_name";

CREATE INDEX IF NOT EXISTS "SupplyRequest_unit_id_idx" ON "SupplyRequest"("unit_id");
CREATE INDEX IF NOT EXISTS "SupplyRequest_user_email_idx" ON "SupplyRequest"("user_email");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplyRequest_unit_id_fkey'
  ) THEN
    ALTER TABLE "SupplyRequest"
      ADD CONSTRAINT "SupplyRequest_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "OrgUnit"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
