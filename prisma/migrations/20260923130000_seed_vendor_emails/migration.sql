-- 시드 외주업체 이메일 보강 (비어 있을 때만)
UPDATE "ProductionVendorMaster"
SET email = 'song@artroric.com', "updatedAt" = NOW()
WHERE "label" = '아트로릭' AND (email IS NULL OR TRIM(email) = '');

UPDATE "ProductionVendorMaster"
SET email = 'dream7395@naver.com', "updatedAt" = NOW()
WHERE "label" = '드림디포' AND (email IS NULL OR TRIM(email) = '');
