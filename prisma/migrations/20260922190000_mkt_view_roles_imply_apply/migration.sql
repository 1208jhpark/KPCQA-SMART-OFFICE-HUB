-- 기존 열람 LV만 지정된 물품도 신청 허용과 동일하게 맞춤
UPDATE "MarketingItem"
SET "view_allow_apply" = true
WHERE "view_allow_apply" = false
  AND "view_role_ids" IS NOT NULL
  AND jsonb_typeof("view_role_ids"::jsonb) = 'array'
  AND jsonb_array_length("view_role_ids"::jsonb) > 0;
