-- ITAsset: stable owner identity (email / user id)
ALTER TABLE "ITAsset" ADD COLUMN IF NOT EXISTS "user_email" TEXT;
ALTER TABLE "ITAsset" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

-- ITRequest: stable requester identity
ALTER TABLE "ITRequest" ADD COLUMN IF NOT EXISTS "requester_email" TEXT;
ALTER TABLE "ITRequest" ADD COLUMN IF NOT EXISTS "requester_id" TEXT;

-- Archive restore parity
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "user_email" TEXT;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "user_id" TEXT;

CREATE INDEX IF NOT EXISTS "ITAsset_user_email_idx" ON "ITAsset"("user_email");
CREATE INDEX IF NOT EXISTS "ITAsset_user_id_idx" ON "ITAsset"("user_id");
CREATE INDEX IF NOT EXISTS "ITRequest_requester_email_idx" ON "ITRequest"("requester_email");
CREATE INDEX IF NOT EXISTS "ITRequest_requester_id_idx" ON "ITRequest"("requester_id");

-- Backfill from User by exact name match (legacy rows)
UPDATE "ITAsset" a
SET
  "user_email" = u.email,
  "user_id" = u.id
FROM "User" u
WHERE a."user_email" IS NULL
  AND a."user" IS NOT NULL
  AND TRIM(a."user") <> ''
  AND TRIM(a."user") <> '-'
  AND TRIM(a."user") <> '공용'
  AND a."user" = u.name;

UPDATE "ITRequest" r
SET
  "requester_email" = u.email,
  "requester_id" = u.id
FROM "User" u
WHERE r."requester_email" IS NULL
  AND r."requester" IS NOT NULL
  AND TRIM(r."requester") <> ''
  AND TRIM(r."requester") <> '-'
  AND r."requester" = u.name;

UPDATE "ITAssetArchive" a
SET
  "user_email" = u.email,
  "user_id" = u.id
FROM "User" u
WHERE a."user_email" IS NULL
  AND a."user" IS NOT NULL
  AND TRIM(a."user") <> ''
  AND TRIM(a."user") <> '-'
  AND TRIM(a."user") <> '공용'
  AND a."user" = u.name;
