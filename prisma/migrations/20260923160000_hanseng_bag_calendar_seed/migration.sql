-- 한생미디어(쇼핑백) → 한생미디어(쇼핑백, 달력) + 이메일·비고 갱신
UPDATE "ProductionVendorMaster"
SET
  "label" = '한생미디어(쇼핑백, 달력)',
  email = 'kskim@kpcm.or.kr',
  items = '쇼핑백, 달력',
  "isActive" = true,
  "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng_bag'
   OR "label" IN ('한생미디어(쇼핑백)', '한생미디어(쇼핑백, 달력)');
