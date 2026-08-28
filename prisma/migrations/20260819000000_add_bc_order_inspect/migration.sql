-- 발주 묶음 거래명세표 검수 결과 (새로고침 후에도 유지)
ALTER TABLE "BusinessCardOrderBatch" ADD COLUMN IF NOT EXISTS "inspectStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "BusinessCardOrderBatch" ADD COLUMN IF NOT EXISTS "inspectFileName" TEXT;
ALTER TABLE "BusinessCardOrderBatch" ADD COLUMN IF NOT EXISTS "inspectResult" JSONB;
ALTER TABLE "BusinessCardOrderBatch" ADD COLUMN IF NOT EXISTS "inspectedAt" TIMESTAMP(3);
