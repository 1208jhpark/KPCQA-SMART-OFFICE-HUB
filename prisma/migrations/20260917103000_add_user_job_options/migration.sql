-- /admin/users 전용 직책·직급 옵션 (SystemConfig JSON)
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "user_duty_options" JSONB;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "user_grade_options" JSONB;
