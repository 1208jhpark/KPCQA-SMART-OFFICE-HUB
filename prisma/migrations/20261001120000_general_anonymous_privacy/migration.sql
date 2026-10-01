-- 익명 설문: 참여(해시) / 응답(본문) 분리
CREATE TABLE IF NOT EXISTS "GeneralAnonymousParticipation" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralAnonymousParticipation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GeneralAnonymousParticipation_surveyId_emailHash_key"
  ON "GeneralAnonymousParticipation"("surveyId", "emailHash");
CREATE INDEX IF NOT EXISTS "GeneralAnonymousParticipation_surveyId_idx"
  ON "GeneralAnonymousParticipation"("surveyId");

ALTER TABLE "GeneralAnonymousParticipation"
  DROP CONSTRAINT IF EXISTS "GeneralAnonymousParticipation_surveyId_fkey";
ALTER TABLE "GeneralAnonymousParticipation"
  ADD CONSTRAINT "GeneralAnonymousParticipation_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "GeneralSurvey"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "GeneralAnonymousAnswer" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralAnonymousAnswer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GeneralAnonymousAnswer_surveyId_idx"
  ON "GeneralAnonymousAnswer"("surveyId");

ALTER TABLE "GeneralAnonymousAnswer"
  DROP CONSTRAINT IF EXISTS "GeneralAnonymousAnswer_surveyId_fkey";
ALTER TABLE "GeneralAnonymousAnswer"
  ADD CONSTRAINT "GeneralAnonymousAnswer_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "GeneralSurvey"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
