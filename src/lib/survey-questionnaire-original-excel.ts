import * as XLSX from 'xlsx';
import { surveyQuestionTypeLabel } from '@/lib/survey-general-active-excel';

export type SurveyQuestionnaireOriginalMeta = {
  title?: string | null;
  code?: string | null;
  isAnonymous?: boolean | null;
  target?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  deliveryType?: string | null;
};

function hasImage(v: unknown) {
  const s = String(v || '').trim();
  return (
    !!s &&
    (s.startsWith('data:image') ||
      s.startsWith('http') ||
      s.startsWith('/') ||
      s.startsWith('blob:'))
  );
}

function parseQuestions(raw: unknown): any[] {
  try {
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
    }
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return [raw];
  } catch {
    /* ignore */
  }
  return [];
}

/** 빌더 문항 원문을 엑셀(원문텍스트 시트)로 다운로드 */
export function downloadSurveyQuestionnaireOriginalExcel(input: {
  meta: SurveyQuestionnaireOriginalMeta;
  questions: unknown;
  /** 파일명 접두 (기본 survey) */
  filePrefix?: string;
  /** 배달 공고 여부 — 메타 표기용 */
  variant?: 'general' | 'delivery';
}) {
  const questions = Array.isArray(input.questions)
    ? input.questions
    : parseQuestions(input.questions);
  if (questions.length === 0) {
    throw new Error('EMPTY_QUESTIONS');
  }

  const meta = input.meta || {};
  const variant = input.variant || 'general';
  const qCount = questions.filter((q: any) => q?.type !== 'SECTION').length;
  const textLines: string[] = [
    `■ ${variant === 'delivery' ? '공고명' : '게시명'}: ${meta.title || ''}`,
    `■ 식별코드: ${meta.code || ''}`,
  ];
  if (variant === 'delivery' && meta.deliveryType) {
    textLines.push(`■ 신청분류: ${meta.deliveryType === 'ALWAYS' ? '상시' : '기간'}`);
  }
  if (variant === 'general') {
    textLines.push(`■ 익명여부: ${meta.isAnonymous ? '익명' : '기명'}`);
  }
  textLines.push(
    `■ 대상: ${meta.target || ''}`,
    `■ 기간: ${`${meta.startDate || ''} ~ ${meta.endDate || ''} ${meta.endTime || ''}`.trim()}`,
    `■ 문항수: ${qCount}`,
    '',
    '========== 조사 원문 (빌더 문항) ==========',
    ''
  );

  let qNo = 0;
  questions.forEach((q: any) => {
    const isSection = q?.type === 'SECTION';
    if (!isSection) qNo += 1;
    const required = q?.isRequired === true || q?.required === true;
    const title = String(q?.title || '').trim() || '(제목 없음)';
    const desc = String(q?.description || '').trim();
    const typeLabel = surveyQuestionTypeLabel(String(q?.type || ''));
    const opts = Array.isArray(q?.options) ? q.options : [];

    if (isSection) {
      textLines.push(`[섹션] ${title}`);
      if (desc) textLines.push(`  설명: ${desc}`);
      if (hasImage(q?.questionImageUrl) || hasImage(q?.imageUrl)) textLines.push('  (이미지첨부됨)');
      textLines.push('');
      return;
    }

    textLines.push(`Q${qNo}. [${typeLabel}] ${required ? '(필수) ' : ''}${title}`);
    if (desc) textLines.push(`  설명: ${desc}`);
    if (hasImage(q?.questionImageUrl) || hasImage(q?.imageUrl) || hasImage(q?.templateFileData)) {
      textLines.push('  (이미지첨부됨)');
    }
    if (q?.type === 'FILE' && q?.templateFileName) {
      textLines.push(`  서식파일: ${q.templateFileName}`);
    }
    if (q?.type === 'SCALE') {
      textLines.push(`  척도: 1 ~ ${q.scaleMax || 5}`);
    } else if (opts.length === 0) {
      if (q?.type === 'CHOICE_SINGLE' || q?.type === 'CHOICE_MULTI') {
        textLines.push('  (선택지 없음)');
      }
    } else {
      opts.forEach((o: any, oi: number) => {
        const label = String(o?.label ?? o ?? '').trim() || `(옵션 ${oi + 1})`;
        const stock =
          o?.stockLimit != null && String(o.stockLimit).trim() !== '' ? String(o.stockLimit) : '';
        const link = o?.referenceLink ? String(o.referenceLink) : '';
        const imgNote = hasImage(o?.imageUrl) ? ' (이미지첨부됨)' : '';
        textLines.push(
          `  ${oi + 1}) ${label}${stock ? ` [재고:${stock}]` : ''}${link ? ` [링크:${link}]` : ''}${imgNote}`
        );
      });
    }
    textLines.push('');
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(textLines.map((line) => [line])),
    '원문텍스트'
  );
  const safeTitle = String(meta.title || input.filePrefix || 'survey')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .substring(0, 30);
  XLSX.writeFile(wb, `[조사원문]_${safeTitle}.xlsx`);
}
