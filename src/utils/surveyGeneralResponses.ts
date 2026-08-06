/** GET_RESPONSES 페이로드 정규화 (구배열 / 신객체 모두 지원) */
export function normalizeGeneralResponsesPayload(data: unknown): {
  responses: any[];
  anonymousParticipationCounts: Record<string, number>;
} {
  if (Array.isArray(data)) {
    return { responses: data, anonymousParticipationCounts: {} };
  }
  if (data && typeof data === 'object') {
    const obj = data as {
      responses?: unknown;
      anonymousParticipationCounts?: unknown;
      /** 레거시(실이메일 목록) — 더 이상 사용하지 않음 */
      anonymousSubmittedBySurvey?: unknown;
    };
    const counts: Record<string, number> = {};
    if (obj.anonymousParticipationCounts && typeof obj.anonymousParticipationCounts === 'object') {
      Object.entries(obj.anonymousParticipationCounts as Record<string, unknown>).forEach(([k, v]) => {
        const n = Number(v);
        if (Number.isFinite(n)) counts[k] = n;
      });
    } else if (obj.anonymousSubmittedBySurvey && typeof obj.anonymousSubmittedBySurvey === 'object') {
      // 하위호환: 예전 이메일 배열이면 길이만 카운트로 사용
      Object.entries(obj.anonymousSubmittedBySurvey as Record<string, unknown>).forEach(([k, v]) => {
        counts[k] = Array.isArray(v) ? v.length : 0;
      });
    }
    return {
      responses: Array.isArray(obj.responses) ? obj.responses : [],
      anonymousParticipationCounts: counts,
    };
  }
  return { responses: [], anonymousParticipationCounts: {} };
}

export function isMaskedAnonymousEmail(email: string | null | undefined) {
  const e = String(email || '');
  return e.endsWith('@masked.local') || e.startsWith('anonymous-');
}

/**
 * 관리자 화면용 responses 맵
 * - 기명: surveyId_email → answers 포함
 * - 익명: 마스킹 키에만 내용 보관 (실이메일 키 없음)
 */
export function buildAdminResponseMap(
  rows: any[],
  formatDate: (raw: any) => string
): Record<string, any> {
  const realRes: Record<string, any> = {};

  rows.forEach((r: any) => {
    if (!r?.surveyId || !r?.userEmail) return;
    const masked = isMaskedAnonymousEmail(r.userEmail);
    realRes[`${r.surveyId}_${r.userEmail}`] = {
      isDone: true,
      date: r.submittedAt ? formatDate(r.submittedAt) : '-',
      result: '제출완료',
      answers: r.answers || {},
      anonymousContent: masked,
      participationOnly: false,
    };
  });

  return realRes;
}

/** 익명 설문의 다운로드용 답변 목록 (신원과 분리된 masked 행) */
export function listAnonymousContentRows(
  responses: Record<string, any>,
  surveyId: string
): Array<{ date: string; answers: any }> {
  return Object.entries(responses)
    .filter(([key, v]) => key.startsWith(`${surveyId}_`) && v?.anonymousContent)
    .map(([, v]) => ({
      date: v.date || '-',
      answers: v.answers || {},
    }));
}

/** 익명 참여 인원 — 서버 카운트 우선, 없으면 마스킹 답변 행 수 */
export function getAnonymousDoneCount(
  surveyId: string,
  counts: Record<string, number> | undefined,
  responses: Record<string, any>
): number {
  if (counts && typeof counts[surveyId] === 'number') return counts[surveyId];
  return listAnonymousContentRows(responses, surveyId).length;
}
