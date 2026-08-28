-- D/C 접미 조직코드 체계 (본부=D · 센터=C) — 구코드 일괄 정리
UPDATE "OrgUnit" SET "unit_code" = 'PMD' WHERE "unit_name" = '경영기획본부';
UPDATE "OrgUnit" SET "unit_code" = 'PMC' WHERE "unit_name" = '경영기획센터';
UPDATE "OrgUnit" SET "unit_code" = 'GBD' WHERE "unit_name" = '녹색건축본부';
UPDATE "OrgUnit" SET "unit_code" = 'GBC' WHERE "unit_name" = '녹색건축인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'BSC' WHERE "unit_name" = '건축안전인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'BED' WHERE "unit_name" = '건물에너지본부';
UPDATE "OrgUnit" SET "unit_code" = 'ZEC' WHERE "unit_name" = '제로에너지인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'EERC' WHERE "unit_name" = '에너지효율검토센터';
UPDATE "OrgUnit" SET "unit_code" = 'SCD' WHERE "unit_name" = '표준인증본부';
UPDATE "OrgUnit" SET "unit_code" = 'CCC' WHERE "unit_name" = '적합성인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'SVC' WHERE "unit_name" = '지속가능검증센터';
UPDATE "OrgUnit" SET "unit_code" = 'ESGC' WHERE "unit_name" = 'ESG인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'FGSD' WHERE "unit_name" = '미래성장전략본부';
UPDATE "OrgUnit" SET "unit_code" = 'ISMSC' WHERE "unit_name" = 'ISMS인증센터';
UPDATE "OrgUnit" SET "unit_code" = 'AXIC' WHERE "unit_name" = 'AX혁신센터';
