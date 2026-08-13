-- 월렌탈/구독비 통합: monthly_sub_fee → monthly_fee 흡수 후 컬럼 제거

UPDATE "ITAsset"
SET "monthly_fee" = "monthly_sub_fee"
WHERE COALESCE("monthly_fee", 0) = 0
  AND COALESCE("monthly_sub_fee", 0) <> 0;

UPDATE "ITAssetArchive"
SET "monthly_fee" = "monthly_sub_fee"
WHERE COALESCE("monthly_fee", 0) = 0
  AND COALESCE("monthly_sub_fee", 0) <> 0;

ALTER TABLE "ITAsset" DROP COLUMN IF EXISTS "monthly_sub_fee";
ALTER TABLE "ITAssetArchive" DROP COLUMN IF EXISTS "monthly_sub_fee";
