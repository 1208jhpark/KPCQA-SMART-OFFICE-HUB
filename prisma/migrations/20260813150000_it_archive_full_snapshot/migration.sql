-- IT 아카이브: 복구를 위해 운영 자산 스냅샷 필드 보강
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "rental_months" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "start_date" TEXT;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "entry_source" TEXT;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "last_audit_date" TEXT;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "last_audit_by" TEXT;
ALTER TABLE "ITAssetArchive" ADD COLUMN IF NOT EXISTS "audit_request_date" TEXT;
