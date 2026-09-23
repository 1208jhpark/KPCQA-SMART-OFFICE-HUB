-- 시드 외주업체(한생미디어) 이메일 보강 (비어 있을 때만)
UPDATE "ProductionVendorMaster"
SET email = 'jhylee@kpcm.or.kr', "updatedAt" = NOW()
WHERE "label" = '한생미디어' AND (email IS NULL OR TRIM(email) = '');
