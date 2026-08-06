-- CreateIndex (고객사 대장 집계·이력 조회 성능)
CREATE INDEX IF NOT EXISTS "MarketingDistribution_client_id_idx"
  ON "MarketingDistribution"("client_id");

CREATE INDEX IF NOT EXISTS "MarketingDistribution_client_id_dist_date_idx"
  ON "MarketingDistribution"("client_id", "dist_date");

CREATE INDEX IF NOT EXISTS "MarketingDistribution_status_dist_date_idx"
  ON "MarketingDistribution"("status", "dist_date");
