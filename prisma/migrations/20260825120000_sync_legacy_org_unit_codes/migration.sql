-- 구(舊) 조직코드 → D/C 규칙 최종 코드 동기화 (PMC01 → PMC 등)
UPDATE "OrgUnit" SET "unit_code" = 'PMD' WHERE "unit_code" IN ('MP01', 'PM01', 'MPD01');
UPDATE "OrgUnit" SET "unit_code" = 'PMC' WHERE "unit_code" IN ('MPC01', 'PMC01');
UPDATE "OrgUnit" SET "unit_code" = 'GBD' WHERE "unit_code" IN ('GB01', 'GBD01');
UPDATE "OrgUnit" SET "unit_code" = 'GBC' WHERE "unit_code" IN ('GBC01');
UPDATE "OrgUnit" SET "unit_code" = 'BSC' WHERE "unit_code" IN ('BSC01');
UPDATE "OrgUnit" SET "unit_code" = 'BED' WHERE "unit_code" IN ('BE01', 'BED01');
UPDATE "OrgUnit" SET "unit_code" = 'ZEC' WHERE "unit_code" IN ('ZEC01');
UPDATE "OrgUnit" SET "unit_code" = 'EERC' WHERE "unit_code" IN ('EER01', 'EERC01');
UPDATE "OrgUnit" SET "unit_code" = 'SCD' WHERE "unit_code" IN ('SC01', 'SCD01');
UPDATE "OrgUnit" SET "unit_code" = 'CCC' WHERE "unit_code" IN ('CCC01');
UPDATE "OrgUnit" SET "unit_code" = 'SVC' WHERE "unit_code" IN ('SVC01');
UPDATE "OrgUnit" SET "unit_code" = 'ESGC' WHERE "unit_code" IN ('ESGC01');
UPDATE "OrgUnit" SET "unit_code" = 'FGSD' WHERE "unit_code" IN ('FG01', 'FGSD01');
UPDATE "OrgUnit" SET "unit_code" = 'ISMSC' WHERE "unit_code" IN ('ISMS01', 'ISMSC01');
UPDATE "OrgUnit" SET "unit_code" = 'AXIC' WHERE "unit_code" IN ('AXI01', 'AXC01', 'AXIC01');

-- 조직명 기준 재확인 (admin 수동 수정 누락 대비)
UPDATE "OrgUnit" SET "unit_code" = 'PMD' WHERE "unit_name" = '경영기획본부';
UPDATE "OrgUnit" SET "unit_code" = 'PMC' WHERE "unit_name" = '경영기획센터';
