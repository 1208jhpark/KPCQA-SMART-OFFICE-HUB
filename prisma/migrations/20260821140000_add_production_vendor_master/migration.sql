-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductionVendorMaster" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "managerName" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "items" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionVendorMaster_pkey" PRIMARY KEY ("id")
);

-- 초기 공통 외주 업체 (신청 폼 하드코딩 대체 · 배포 시 seed 없이도 동작)
INSERT INTO "ProductionVendorMaster" ("id", "label", "managerName", "contact", "email", "items", "isActive", "createdAt", "updatedAt")
SELECT 'seed_vend_artrolic', '아트로릭', '', '', '', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ProductionVendorMaster" WHERE "label" = '아트로릭');

INSERT INTO "ProductionVendorMaster" ("id", "label", "managerName", "contact", "email", "items", "isActive", "createdAt", "updatedAt")
SELECT 'seed_vend_hanseng', '한생미디어', '', '', '', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ProductionVendorMaster" WHERE "label" = '한생미디어');

INSERT INTO "ProductionVendorMaster" ("id", "label", "managerName", "contact", "email", "items", "isActive", "createdAt", "updatedAt")
SELECT 'seed_vend_dreamdepot', '드림디포', '', '', '', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ProductionVendorMaster" WHERE "label" = '드림디포');
