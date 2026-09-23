-- 승인 대기(PENDING) 신청분은 catalog/register에서 즉시 예약되도록 재고를 다시 차감한다.
-- (직전 마이그레이션에서 PENDING 선차감을 풀어 둔 분량을 되돌림)
UPDATE "MarketingItem" AS i
SET "current_stock" = GREATEST(0, i."current_stock" - p.pending_qty)
FROM (
  SELECT "item_id", SUM("qty")::int AS pending_qty
  FROM "MarketingDistribution"
  WHERE "status" = 'PENDING'
  GROUP BY "item_id"
) AS p
WHERE i."id" = p."item_id"
  AND p.pending_qty > 0;
