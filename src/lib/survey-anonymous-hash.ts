import crypto from 'crypto';

/**
 * 익명 설문 참여 식별용 HMAC.
 * - DB에는 이 해시만 저장 (평문 이메일 없음)
 * - 설문별 솔트 + 전역 비밀로 동일 이메일이 설문마다 다른 해시
 */
function anonSecret() {
  return (
    String(process.env.SURVEY_ANON_HMAC_SECRET || '').trim() ||
    String(process.env.JWT_SECRET || '').trim() ||
    'dev-survey-anon-hmac'
  );
}

export function normalizeSurveyEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

export function hashSurveyParticipantEmail(
  surveyId: string,
  email: string | null | undefined
): string {
  const normalized = normalizeSurveyEmail(email);
  const sid = String(surveyId || '').trim();
  return crypto
    .createHmac('sha256', `${anonSecret()}:${sid}`)
    .update(normalized)
    .digest('hex');
}
