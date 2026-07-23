import { getKSTDateString, getKSTDaysUntil, parseKSTDateOnly } from '@/utils/dateUtils';

/** 검교정 일정 확인 윈도우: D-N ~ D-Day ~ D+ */
export const CALIB_SCHEDULE_WINDOW_DAYS = 30;

/** YYYY-MM-DD (ISO Date도 KST 달력일로 정규화) */
export function toCalibYmd(raw: string | Date | null | undefined | unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (raw instanceof Date || typeof raw === 'number' || typeof raw === 'string') {
    const ymd = getKSTDateString(raw);
    return ymd || null;
  }
  return null;
}

export function addMonthsToCalibYmd(
  dateStr: string | null | undefined,
  months: number | null | undefined
): string | null {
  if (!dateStr || months == null || Number(months) === 0) return null;
  const ymd = toCalibYmd(dateStr);
  if (!ymd) return null;
  const d = parseKSTDateOnly(ymd);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Number(months));
  return getKSTDateString(d);
}

/** 이력 중 검교정 기준일(확정일 우선, 없으면 요청일)이 가장 최근인 건 */
export function pickLatestCalibHistory<T extends Record<string, unknown>>(histories: T[] | null | undefined): T | null {
  if (!histories || histories.length === 0) return null;
  return [...histories].sort((a, b) => {
    const ta = new Date(
      (toCalibYmd(a.calib_date as string) || toCalibYmd(a.calib_request_date as string) || '1970-01-01') + 'T12:00:00+09:00'
    ).getTime();
    const tb = new Date(
      (toCalibYmd(b.calib_date as string) || toCalibYmd(b.calib_request_date as string) || '1970-01-01') + 'T12:00:00+09:00'
    ).getTime();
    return tb - ta;
  })[0];
}

export function getLatestCalibBaseYmd(histories: any[] | null | undefined): string | null {
  const latest = pickLatestCalibHistory(histories);
  if (!latest) return null;
  return toCalibYmd(latest.calib_date) || toCalibYmd(latest.calib_request_date) || null;
}

export function isCalibScheduleDue(
  targetDate: string | Date | null | undefined,
  windowDays = CALIB_SCHEDULE_WINDOW_DAYS
): boolean {
  const ymd = toCalibYmd(targetDate);
  if (!ymd) return false;
  const diffDays = getKSTDaysUntil(ymd);
  return Number.isFinite(diffDays) && diffDays <= windowDays;
}

/**
 * 목록/대시보드/상세 공통 예정일·일정확인 판정.
 * 표시 우선순위: (최신 이력 확정일|요청일 + 주기) → 없으면 저장 next_calib_date
 * ※ 이력으로 산정 가능하면 낡은 next_calib_date에 묶이지 않음
 */
export function resolveCalibSchedule(eq: {
  histories?: any[] | null;
  calib_cycle_mo?: number | null;
  next_calib_date?: string | Date | null;
}): { nCalib: string | null; isDue: boolean; diffDays: number | null } {
  const fromCycle = addMonthsToCalibYmd(getLatestCalibBaseYmd(eq.histories), eq.calib_cycle_mo);
  const fromStored = toCalibYmd(eq.next_calib_date);
  const nCalib = fromCycle || fromStored || null;
  const isDue = isCalibScheduleDue(nCalib);
  const diffDays = nCalib ? getKSTDaysUntil(nCalib) : null;
  return { nCalib, isDue, diffDays };
}
