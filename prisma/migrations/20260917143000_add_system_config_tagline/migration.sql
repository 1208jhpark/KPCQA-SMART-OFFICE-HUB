-- 홈 히어로 상단 배지 문구 (/admin/interface Tagline)
ALTER TABLE "SystemConfig"
  ADD COLUMN IF NOT EXISTS "tagline" TEXT NOT NULL DEFAULT 'Workplace Innovative System for Efficiency';
