ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "prod_vendor_link_sign" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "prod_vendor_link_jebon" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "prod_vendor_link_print" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "prod_vendor_link_supplies" TEXT NOT NULL DEFAULT '';
