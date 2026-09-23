-- IT 자산 교체 사용 연장(유예)
ALTER TABLE "ITAsset" ADD COLUMN IF NOT EXISTS "replace_deferred" BOOLEAN NOT NULL DEFAULT false;
