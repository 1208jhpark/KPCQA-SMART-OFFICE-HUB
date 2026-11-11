-- 법인카드 대장 (신규 배포 포함 CREATE + memo)
CREATE TABLE IF NOT EXISTS "CorpCard" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuer" TEXT NOT NULL DEFAULT '',
  "last4" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "unitName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "memo" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpCard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorpCard_unitId_idx" ON "CorpCard"("unitId");
CREATE INDEX IF NOT EXISTS "CorpCard_status_idx" ON "CorpCard"("status");
CREATE INDEX IF NOT EXISTS "CorpCard_createdAt_idx" ON "CorpCard"("createdAt");

ALTER TABLE "CorpCard" ADD COLUMN IF NOT EXISTS "memo" TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE "CorpCard"
    ADD CONSTRAINT "CorpCard_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
