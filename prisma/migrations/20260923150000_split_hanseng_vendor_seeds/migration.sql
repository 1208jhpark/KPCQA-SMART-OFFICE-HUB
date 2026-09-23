-- 한생미디어 시드 분리: 통합 1건 → 상장케이스 / 제본 / 쇼핑백 3건

-- 1) 구 통합 시드 비활성 + JEBON 우선연결 해제
UPDATE "ProductionVendorMaster"
SET
  "isActive" = false,
  "priorityCategory" = '',
  "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng'
   OR ("label" = '한생미디어' AND id NOT LIKE 'seed_vend_hanseng_%');

-- 2) 한생미디어(상장케이스)
INSERT INTO "ProductionVendorMaster"
  ("id", "label", "managerName", "contact", "email", "items", "priorityCategory", "isActive", "createdAt", "updatedAt")
SELECT
  'seed_vend_hanseng_case', '한생미디어(상장케이스)', '', '', 'jhylee@kpcm.or.kr', '상장케이스', '', true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductionVendorMaster"
  WHERE id = 'seed_vend_hanseng_case' OR "label" = '한생미디어(상장케이스)'
);

-- 3) 한생미디어(제본) — JEBON 우선연결
INSERT INTO "ProductionVendorMaster"
  ("id", "label", "managerName", "contact", "email", "items", "priorityCategory", "isActive", "createdAt", "updatedAt")
SELECT
  'seed_vend_hanseng_jebon', '한생미디어(제본)', '', '',
  'kskim@kpcm.or.kr, jhseok@kpcm.or.kr', '제본', 'JEBON', true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductionVendorMaster"
  WHERE id = 'seed_vend_hanseng_jebon' OR "label" = '한생미디어(제본)'
);

-- 4) 한생미디어(쇼핑백)
INSERT INTO "ProductionVendorMaster"
  ("id", "label", "managerName", "contact", "email", "items", "priorityCategory", "isActive", "createdAt", "updatedAt")
SELECT
  'seed_vend_hanseng_bag', '한생미디어(쇼핑백)', '', '', '', '쇼핑백', '', true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductionVendorMaster"
  WHERE id = 'seed_vend_hanseng_bag' OR "label" = '한생미디어(쇼핑백)'
);

-- 5) JEBON은 제본 시드만 유지
UPDATE "ProductionVendorMaster"
SET "priorityCategory" = '', "updatedAt" = NOW()
WHERE "priorityCategory" = 'JEBON'
  AND id <> 'seed_vend_hanseng_jebon'
  AND "label" <> '한생미디어(제본)';

UPDATE "ProductionVendorMaster"
SET "priorityCategory" = 'JEBON', "isActive" = true, "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng_jebon' OR "label" = '한생미디어(제본)';
