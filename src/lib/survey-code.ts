import { getKSTDateString } from '@/utils/dateUtils';

/**
 * 설문/배달 식별코드: `{PREFIX}-{YYMMDD}-{순번}`
 * 예) SRV-261112-01, DEL-261112-02
 * (구 규칙 SRV-NEW-9786 은 타임스탬프 끝 4자리였음)
 */
export function nextSurveyCode(
  prefix: 'SRV' | 'DEL',
  existingCodes: Array<string | null | undefined>,
  dateInput: Date | string | number = Date.now()
): string {
  const ymdFull = getKSTDateString(dateInput).replace(/-/g, ''); // YYYYMMDD
  const ymd = ymdFull.length >= 8 ? ymdFull.slice(2) : ymdFull; // YYMMDD
  const head = `${prefix}-${ymd}-`;
  let maxSeq = 0;
  for (const raw of existingCodes) {
    const code = String(raw || '').trim();
    if (!code.startsWith(head)) continue;
    const seq = Number(code.slice(head.length));
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${head}${String(maxSeq + 1).padStart(2, '0')}`;
}
