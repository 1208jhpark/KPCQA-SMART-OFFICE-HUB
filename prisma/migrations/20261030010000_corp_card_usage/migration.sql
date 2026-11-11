-- 법인카드 사용 이력
CREATE TABLE IF NOT EXISTS "CorpCardUsage" (
  "id" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "unitName" TEXT NOT NULL DEFAULT '',
  "cardName" TEXT NOT NULL DEFAULT '',
  "issuer" TEXT NOT NULL DEFAULT '',
  "last4" TEXT NOT NULL DEFAULT '',
  "userId" TEXT,
  "userName" TEXT NOT NULL DEFAULT '',
  "userEmail" TEXT NOT NULL DEFAULT '',
  "place" TEXT NOT NULL DEFAULT '',
  "purpose" TEXT NOT NULL DEFAULT '',
  "reservedAt" TIMESTAMP(3),
  "checkoutAt" TIMESTAMP(3),
  "expectedReturnAt" TIMESTAMP(3),
  "amount" TEXT NOT NULL DEFAULT '',
  "returnedAt" TIMESTAMP(3),
  "userConfirmedBy" TEXT NOT NULL DEFAULT '',
  "userConfirmedAt" TIMESTAMP(3),
  "managerConfirmedBy" TEXT NOT NULL DEFAULT '',
  "managerConfirmedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpCardUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorpCardUsage_cardId_idx" ON "CorpCardUsage"("cardId");
CREATE INDEX IF NOT EXISTS "CorpCardUsage_unitId_idx" ON "CorpCardUsage"("unitId");
CREATE INDEX IF NOT EXISTS "CorpCardUsage_status_idx" ON "CorpCardUsage"("status");
CREATE INDEX IF NOT EXISTS "CorpCardUsage_createdAt_idx" ON "CorpCardUsage"("createdAt");

ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "pickupType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "pickupName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "checkoutConfirmedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "checkoutConfirmedAt" TIMESTAMP(3);
ALTER TABLE "CorpCardUsage" ADD COLUMN IF NOT EXISTS "returnType" TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE "CorpCardUsage"
    ADD CONSTRAINT "CorpCardUsage_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "CorpCard"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
