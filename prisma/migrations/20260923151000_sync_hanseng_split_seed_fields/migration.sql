UPDATE "ProductionVendorMaster"
SET email = 'jhylee@kpcm.or.kr', items = '상장케이스', "isActive" = true, "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng_case' OR "label" = '한생미디어(상장케이스)';

UPDATE "ProductionVendorMaster"
SET email = 'kskim@kpcm.or.kr, jhseok@kpcm.or.kr', items = '제본', "priorityCategory" = 'JEBON', "isActive" = true, "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng_jebon' OR "label" = '한생미디어(제본)';

UPDATE "ProductionVendorMaster"
SET email = '', items = '쇼핑백', "isActive" = true, "updatedAt" = NOW()
WHERE id = 'seed_vend_hanseng_bag' OR "label" = '한생미디어(쇼핑백)';
