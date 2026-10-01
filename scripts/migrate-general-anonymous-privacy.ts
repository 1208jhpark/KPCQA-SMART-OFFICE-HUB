/**
 * 기존 익명 GeneralResponse(평문 이메일+답변 한 줄) →
 *   GeneralAnonymousParticipation(해시) + GeneralAnonymousAnswer(본문)
 * 로 분리하고, 원본 GeneralResponse 행을 삭제합니다.
 *
 * 사용: npx tsx scripts/migrate-general-anonymous-privacy.ts
 */
import { PrismaClient } from '@prisma/client';
import { hashSurveyParticipantEmail } from '../src/lib/survey-anonymous-hash';

const prisma = new PrismaClient();

async function main() {
  const anonSurveys = await prisma.generalSurvey.findMany({
    where: { isAnonymous: true },
    select: { id: true, title: true },
  });
  if (anonSurveys.length === 0) {
    console.log('익명 설문 없음 — 이전할 데이터 없음');
    return;
  }

  const surveyIds = anonSurveys.map((s) => s.id);
  const rows = await prisma.generalResponse.findMany({
    where: { surveyId: { in: surveyIds } },
    orderBy: { submittedAt: 'asc' },
  });

  console.log(`익명 설문 ${anonSurveys.length}개, 이전 대상 응답 ${rows.length}건`);

  let moved = 0;
  let skipped = 0;

  for (const row of rows) {
    const email = String(row.userEmail || '').trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    const emailHash = hashSurveyParticipantEmail(row.surveyId, email);

    await prisma.$transaction(async (tx) => {
      await tx.generalAnonymousParticipation.upsert({
        where: {
          surveyId_emailHash: { surveyId: row.surveyId, emailHash },
        },
        create: {
          surveyId: row.surveyId,
          emailHash,
          submittedAt: row.submittedAt,
        },
        update: {},
      });

      await tx.generalAnonymousAnswer.create({
        data: {
          surveyId: row.surveyId,
          answers: (row.answers as any) ?? {},
          submittedAt: row.submittedAt,
        },
      });

      await tx.generalResponse.delete({ where: { id: row.id } });
    });

    moved += 1;
  }

  console.log(`완료: 이전 ${moved}건, 스킵 ${skipped}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
