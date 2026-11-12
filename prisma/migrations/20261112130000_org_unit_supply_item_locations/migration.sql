-- OrgUnit 품목별 보관위치 JSON (스키마에만 있고 마이그레이션 누락 → /api/auth/me include unit 시 P2022)
ALTER TABLE "OrgUnit" ADD COLUMN IF NOT EXISTS "supply_item_locations" JSONB NOT NULL DEFAULT '{}';
