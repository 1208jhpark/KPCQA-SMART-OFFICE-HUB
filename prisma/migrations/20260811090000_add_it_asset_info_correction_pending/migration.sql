-- AlterTable
ALTER TABLE "ITAsset" ADD COLUMN IF NOT EXISTS "info_correction_pending" JSONB;
