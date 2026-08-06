-- 타부서 열람 LV 지정자에게 지급 신청 허용 여부
ALTER TABLE "MarketingItem" ADD COLUMN IF NOT EXISTS "view_allow_apply" BOOLEAN NOT NULL DEFAULT false;
