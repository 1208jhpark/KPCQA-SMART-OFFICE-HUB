-- 부서별 제작 외주 메일 양식 (검수 화면 업체 메일 발송)
CREATE TABLE IF NOT EXISTS "ProductionDeptMailSettings" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "mailShortcutUrl" TEXT NOT NULL DEFAULT '',
    "subjectTemplate" TEXT NOT NULL DEFAULT '',
    "bodyTemplate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDeptMailSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionDeptMailSettings_unitId_key"
  ON "ProductionDeptMailSettings"("unitId");
