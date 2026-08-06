-- MarketingItem: 카탈로그 열람 레벨 (GLOBAL_MGMT 계열만 UI에서 설정)
ALTER TABLE "MarketingItem" ADD COLUMN IF NOT EXISTS "view_role_ids" JSONB DEFAULT '[]';
