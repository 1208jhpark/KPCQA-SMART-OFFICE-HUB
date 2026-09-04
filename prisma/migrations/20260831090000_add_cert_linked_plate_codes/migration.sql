-- AlterTable
ALTER TABLE "ProductionCertMaster" ADD COLUMN IF NOT EXISTS "linkedPlateCodes" JSONB NOT NULL DEFAULT '[]';
