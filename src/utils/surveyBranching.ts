/** 배달/일반 설문 분기(goToSectionId) 공통 엔진 */

export type SurveyAnswerDomain = 'delivery' | 'general';

/** 문항 타입·도메인별 응답 존재 여부 (주소 flat/중첩 포함) */
export function hasSurveyAnswer(
  q: any,
  answers: Record<string, any>,
  domain: SurveyAnswerDomain = 'general'
): boolean {
  if (!q) return false;

  if (q.type === 'SEARCH_ADDRESS') {
    if (domain === 'delivery') {
      return Boolean(answers[`${q.id}_zip`] && answers[`${q.id}_road`]);
    }
    const addr = answers[q.id];
    return Boolean(addr?.zipCode && addr?.roadAddress);
  }

  if (q.type === 'FILE') {
    return Boolean(answers[q.id]?.fileName);
  }

  const val = answers[q.id];
  if (val === undefined || val === null || val === '') return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

/**
 * 현재 문항 응답 기준 다음 섹션 ID.
 * - CHOICE_SINGLE: 선택 옵션의 goToSectionId
 * - CHOICE_MULTI: 선택 옵션 중(옵션 배열 순서) 첫 goToSectionId
 * - 그 외: 문항 레벨 goToSectionId (응답이 있을 때만)
 */
export function resolveBranchTarget(
  q: any,
  answers: Record<string, any>,
  domain: SurveyAnswerDomain = 'general'
): string | undefined {
  if (!q) return undefined;

  if (q.type === 'CHOICE_SINGLE') {
    const userAns = answers[q.id];
    if (userAns) {
      const selectedOpt = q.options?.find((o: any) => o.label === userAns);
      if (selectedOpt?.goToSectionId) return selectedOpt.goToSectionId;
    }
  }

  if (q.type === 'CHOICE_MULTI') {
    const selected: string[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];
    if (selected.length > 0 && Array.isArray(q.options)) {
      for (const opt of q.options) {
        if (selected.includes(opt.label) && opt.goToSectionId) {
          return opt.goToSectionId;
        }
      }
    }
  }

  if (q.goToSectionId && hasSurveyAnswer(q, answers, domain)) {
    return q.goToSectionId;
  }

  return undefined;
}

/** 문항의 부모 섹션 ID (섹션 없으면 null) */
export function getParentSectionId(q: any, questions: any[]): string | null {
  if (!q) return null;
  if (q.type === 'SECTION') return q.id;
  const list = Array.isArray(questions) ? questions : [];
  const idx = list.findIndex((item: any) => item.id === q.id);
  if (idx === -1) return null;
  const lastSection = list.slice(0, idx + 1).reverse().find((item: any) => item.type === 'SECTION');
  return lastSection ? lastSection.id : null;
}

/** 분기 경로상 실제 노출되는 문항 목록 */
export function getVisibleQuestionsByBranch(
  questions: any[],
  answers: Record<string, any>,
  domain: SurveyAnswerDomain = 'general'
): any[] {
  const list = Array.isArray(questions) ? questions : [];
  const visible: any[] = [];
  let currentIndex = 0;

  while (currentIndex < list.length) {
    const q = list[currentIndex];
    visible.push(q);

    const nextSectionId = resolveBranchTarget(q, answers, domain);
    if (nextSectionId) {
      if (nextSectionId === 'SUBMIT') break;
      const targetIdx = list.findIndex((item: any) => item.id === nextSectionId);
      if (targetIdx !== -1 && targetIdx > currentIndex) {
        currentIndex = targetIdx;
        continue;
      }
    }
    currentIndex++;
  }

  return visible;
}

/**
 * 저장된 답변으로 거쳐온 섹션 히스토리 복원 (수정 모드 / 임시저장 재개용)
 */
export function buildSectionHistoryFromAnswers(
  questions: any[],
  answers: Record<string, any>,
  domain: SurveyAnswerDomain = 'general'
): (string | null)[] {
  const visible = getVisibleQuestionsByBranch(questions, answers, domain);
  const hist: (string | null)[] = [];

  for (const q of visible) {
    if (q.type === 'SECTION') {
      if (hist[hist.length - 1] !== q.id) hist.push(q.id);
      continue;
    }
    const parent = getParentSectionId(q, questions);
    if (hist.length === 0 || hist[hist.length - 1] !== parent) {
      hist.push(parent);
    }
  }

  return hist;
}
