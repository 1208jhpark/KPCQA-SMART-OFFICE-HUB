-- 전 모듈: 조직명 스냅샷과 별도로 OrgUnit.id 고정 (admin/units 명칭 변경 추적)

-- ITAsset
ALTER TABLE "ITAsset" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
UPDATE "ITAsset" AS a SET "unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE a."unit_id" IS NULL AND a."dept" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "ITAsset_unit_id_idx" ON "ITAsset"("unit_id");

-- ITAssetArchive
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
UPDATE "ITAssetArchive" AS a SET "unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE a."unit_id" IS NULL AND a."dept" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "ITAssetArchive_unit_id_idx" ON "ITAssetArchive"("unit_id");

-- ITRequest
ALTER TABLE "ITRequest" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
UPDATE "ITRequest" AS r SET "unit_id" = u."unit_id"
FROM "User" u
WHERE r."unit_id" IS NULL AND u.email = r."requester_email" AND u."unit_id" IS NOT NULL;
UPDATE "ITRequest" AS r SET "unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE r."unit_id" IS NULL AND r."dept" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "ITRequest_unit_id_idx" ON "ITRequest"("unit_id");

-- Equipment
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
UPDATE "Equipment" AS e SET "unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE e."unit_id" IS NULL AND e."department" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "Equipment_unit_id_idx" ON "Equipment"("unit_id");

-- MarketingItem
ALTER TABLE "MarketingItem" ADD COLUMN IF NOT EXISTS "owner_unit_id" TEXT;
UPDATE "MarketingItem" AS m SET "owner_unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE m."owner_unit_id" IS NULL AND m."owner_dept" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "MarketingItem_owner_unit_id_idx" ON "MarketingItem"("owner_unit_id");

-- MarketingDistribution
ALTER TABLE "MarketingDistribution" ADD COLUMN IF NOT EXISTS "sender_unit_id" TEXT;
UPDATE "MarketingDistribution" AS d SET "sender_unit_id" = u."unit_id"
FROM "User" u
WHERE d."sender_unit_id" IS NULL AND u.email = d."sender_email" AND u."unit_id" IS NOT NULL;
UPDATE "MarketingDistribution" AS d SET "sender_unit_id" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE d."sender_unit_id" IS NULL AND d."sender_dept" = matched."unit_name";

-- SupplyItem owner_unit_ids (JSON array) — backfill from unique owner_dept names when single name
ALTER TABLE "SupplyItem" ADD COLUMN IF NOT EXISTS "owner_unit_ids" JSONB DEFAULT '[]'::jsonb;
UPDATE "SupplyItem" AS s
SET "owner_unit_ids" = to_jsonb(ARRAY[matched.id])
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE (s."owner_unit_ids" IS NULL OR s."owner_unit_ids"::text IN ('[]', 'null'))
  AND s."owner_dept" = matched."unit_name";

-- Surveys / ITAudit target_unit_ids
ALTER TABLE "GeneralSurvey" ADD COLUMN IF NOT EXISTS "target_unit_ids" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "DeliverySurvey" ADD COLUMN IF NOT EXISTS "target_unit_ids" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE "ITAudit" ADD COLUMN IF NOT EXISTS "target_unit_ids" JSONB DEFAULT '[]'::jsonb;

-- BusinessCardRequest
ALTER TABLE "BusinessCardRequest" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
UPDATE "BusinessCardRequest" AS b SET "unitId" = u."unit_id"
FROM "User" u
WHERE b."unitId" IS NULL AND u.email = b."userEmail" AND u."unit_id" IS NOT NULL;
UPDATE "BusinessCardRequest" AS b SET "unitId" = matched.id
FROM (
  SELECT ou."unit_name", MIN(ou."id") AS id FROM "OrgUnit" ou
  WHERE ou."is_deleted" = false GROUP BY ou."unit_name" HAVING COUNT(*) = 1
) AS matched
WHERE b."unitId" IS NULL AND b."deptName" = matched."unit_name";
CREATE INDEX IF NOT EXISTS "BusinessCardRequest_unitId_idx" ON "BusinessCardRequest"("unitId");
