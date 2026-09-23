-- AlterTable: 전사 공통 주소 국문 상세 분리
ALTER TABLE "CompanyAddress" ADD COLUMN IF NOT EXISTS "addressDetailKo" TEXT NOT NULL DEFAULT '';

-- 기존 시드형 주소 분리 (도로명 / 건물·층)
UPDATE "CompanyAddress"
SET
  "addressKo" = '서울특별시 중구 세종대로 39',
  "addressDetailKo" = '대한상공회의소빌딩 12층'
WHERE "addressKo" = '서울특별시 중구 세종대로 39 대한상공회의소빌딩 12층'
   OR ("addressKo" LIKE '서울특별시 중구 세종대로 39%' AND "addressDetailKo" = '' AND "addressKo" LIKE '%12층%');

UPDATE "CompanyAddress"
SET
  "addressKo" = '서울특별시 중구 세종대로 39',
  "addressDetailKo" = '대한상공회의소빌딩 11층'
WHERE "addressKo" = '서울특별시 중구 세종대로 39 대한상공회의소빌딩 11층'
   OR ("addressKo" LIKE '서울특별시 중구 세종대로 39%' AND "addressDetailKo" = '' AND "addressKo" LIKE '%11층%');
