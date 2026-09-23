-- PENDING 신청은 재고를 선차감하지 않고 승인 시점에 차감하도록 변경.
-- 기존 PENDING 건이 이미 차감해 둔 재고를 복구해 둔다.
UPDATE "MarketingItem" AS i
SET "current_stock" = i."current_stock" + p.pending_qty
FROM (
  SELECT "item_id", SUM("qty")::int AS pending_qty
  FROM "MarketingDistribution"
  WHERE "status" = 'PENDING'
  GROUP BY "item_id"
) AS p
WHERE i."id" = p."item_id"
  AND p.pending_qty > 0;
