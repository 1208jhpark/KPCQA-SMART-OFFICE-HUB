-- ProductionRequest.unitId: 조직 스코프를 이름 스냅샷이 아닌 OrgUnit FK로 고정
ALTER TABLE "ProductionRequest" ADD COLUMN IF NOT EXISTS "unitId" TEXT;

-- 1) 신청자 User.unit_id로 백필 (현재 소속 — 이동한 사용자는 2단계에서 이름 매칭으로 보완)
UPDATE "ProductionRequest" AS pr
SET "unitId" = u."unit_id"
FROM "User" AS u
WHERE pr."unitId" IS NULL
  AND u.email = pr."userEmail"
  AND u."unit_id" IS NOT NULL;

-- 2) 남은 행: deptName ↔ OrgUnit.unit_name (동명 조직 1개일 때만)
UPDATE "ProductionRequest" AS pr
SET "unitId" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id
  FROM "OrgUnit" AS ou
  WHERE ou."is_deleted" = false
  GROUP BY ou."unit_name"
  HAVING COUNT(*) = 1
) AS matched
WHERE pr."unitId" IS NULL
  AND pr."deptName" = matched."unit_name";

CREATE INDEX IF NOT EXISTS "ProductionRequest_unitId_idx" ON "ProductionRequest"("unitId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductionRequest_unitId_fkey'
  ) THEN
    ALTER TABLE "ProductionRequest"
      ADD CONSTRAINT "ProductionRequest_unitId_fkey"
      FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
