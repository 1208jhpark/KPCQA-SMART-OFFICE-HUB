-- ProductionRequest: 공정상태 변경 시각 (원문 수정과 분리)
ALTER TABLE "ProductionRequest" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);

-- 기존 건: 대략의 마지막 갱신 시각으로 백필 (이후부터는 상태 변경 시에만 갱신)
UPDATE "ProductionRequest"
SET "statusChangedAt" = "updatedAt"
WHERE "statusChangedAt" IS NULL;
