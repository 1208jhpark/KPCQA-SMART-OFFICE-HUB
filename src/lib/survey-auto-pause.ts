import prisma from '@/lib/prisma';
import { isPastKSTDeadline } from '@/utils/dateUtils';

/** 수동 내리기(게시중단)와 구분: 기간 만료 자동 내리기 */
export const SURVEY_STATUS_EXPIRED = '기간종료';
export const SURVEY_STATUS_PAUSED = '게시중단';

export function isSurveyPausedOrExpired(status: string | null | undefined) {
  return status === SURVEY_STATUS_PAUSED || status === SURVEY_STATUS_EXPIRED;
}

/** 진행중 + 마감시각 경과 → 기간종료(자동 내리기) 일괄 반영 */
export async function autoPauseExpiredGeneralSurveys() {
  const active = await prisma.generalSurvey.findMany({
    where: { status: '진행중' },
    select: { id: true, endDate: true, endTime: true },
  });
  const expiredIds = active
    .filter((s) => isPastKSTDeadline(s.endDate, s.endTime || '23:59'))
    .map((s) => s.id);
  if (expiredIds.length === 0) return 0;

  await prisma.generalSurvey.updateMany({
    where: { id: { in: expiredIds }, status: '진행중' },
    data: { status: SURVEY_STATUS_EXPIRED },
  });
  return expiredIds.length;
}

export async function autoPauseExpiredDeliverySurveys() {
  const active = await prisma.deliverySurvey.findMany({
    where: { status: '진행중' },
    select: { id: true, endDate: true, endTime: true },
  });
  const expiredIds = active
    .filter((s) => isPastKSTDeadline(s.endDate, s.endTime || '23:59'))
    .map((s) => s.id);
  if (expiredIds.length === 0) return 0;

  await prisma.deliverySurvey.updateMany({
    where: { id: { in: expiredIds }, status: '진행중' },
    data: { status: SURVEY_STATUS_EXPIRED },
  });
  return expiredIds.length;
}

/** 단건: 기한 경과 시 진행중 → 기간종료 */
export async function autoPauseGeneralSurveyIfExpired(survey: {
  id: string;
  status: string;
  endDate: string;
  endTime?: string | null;
}) {
  if (survey.status !== '진행중') return false;
  if (!isPastKSTDeadline(survey.endDate, survey.endTime || '23:59')) return false;
  await prisma.generalSurvey.updateMany({
    where: { id: survey.id, status: '진행중' },
    data: { status: SURVEY_STATUS_EXPIRED },
  });
  return true;
}

export async function autoPauseDeliverySurveyIfExpired(survey: {
  id: string;
  status: string;
  endDate: string;
  endTime?: string | null;
}) {
  if (survey.status !== '진행중') return false;
  if (!isPastKSTDeadline(survey.endDate, survey.endTime || '23:59')) return false;
  await prisma.deliverySurvey.updateMany({
    where: { id: survey.id, status: '진행중' },
    data: { status: SURVEY_STATUS_EXPIRED },
  });
  return true;
}
