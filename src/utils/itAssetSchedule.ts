/**
 * IT 자산 교체예정·D-day — 마스터 대시보드 규칙이 단일 소스.
 * personal/dept는 API가 붙인 replace_due_date / replace_dday 를 표시만 한다.
 */
import { addMonthsToKSTDateOnly, getKSTDateString, getKSTDaysUntil, getKSTYearMonth } from '@/utils/dateUtils';

export type ItAssetSchedule = {
  /** 교체 기준일 (입고일) */
  scheduleBaseDate: string | null;
  /** 교체예정일 YYYY-MM-DD 또는 '-' */
  replace_due_date: string;
  /** 오늘(KST) 기준 D-day (예정일 - 오늘). 계산 불가면 null */
  replace_dday: number | null;
};

/** 마스터 규칙: 교체예정 = 입고일(in_date) + 교체주기(M) */
export function computeItAssetReplaceSchedule(asset: {
  in_date?: string | null;
  cycle?: number | string | null;
}): ItAssetSchedule {
  const inDate = String(asset.in_date || '').trim();
  const cycleNum = parseInt(String(asset.cycle ?? ''), 10) || 0;
  if (!inDate || cycleNum <= 0) {
    return { scheduleBaseDate: inDate || null, replace_due_date: '-', replace_dday: null };
  }
  const computed = addMonthsToKSTDateOnly(inDate, cycleNum);
  if (!computed) {
    return { scheduleBaseDate: inDate, replace_due_date: '-', replace_dday: null };
  }
  return {
    scheduleBaseDate: inDate,
    replace_due_date: computed,
    replace_dday: getKSTDaysUntil(computed),
  };
}

/** API/목록 행에 스케줄 필드 부착 (수신 전용 페이지용) */
export function withItAssetScheduleFields<T extends Record<string, any>>(asset: T): T & ItAssetSchedule {
  const s = computeItAssetReplaceSchedule(asset);
  return {
    ...asset,
    scheduleBaseDate: s.scheduleBaseDate,
    replace_due_date: s.replace_due_date,
    replace_dday: s.replace_dday,
  };
}

/**
 * 렌탈/구독 회차 표시 — KST 연월 기준.
 * 총 회차: 계약 구간(in_date~end_date).
 * 현재 회차: 첫회청구 기준. 첫회청구 없으면 0 (오늘로 대체하지 않음).
 */
export function computeItAssetTurnDisplay(asset: {
  in_date?: string | null;
  end_date?: string | null;
  first_bill?: string | null;
  rental_months?: number | string | null;
}): string {
  const startYm = getKSTYearMonth(asset.in_date);
  const endYm = getKSTYearMonth(asset.end_date);
  if (!startYm || !endYm) return '-';
  const total =
    (endYm.year - startYm.year) * 12 + (endYm.month - startYm.month);
  const totalLabel = total > 0 ? total : 0;

  const firstYm = getKSTYearMonth(asset.first_bill);
  if (!firstYm) return `0 / ${totalLabel}`;

  const nowYm = getKSTYearMonth(getKSTDateString());
  if (!nowYm) return `0 / ${totalLabel}`;
  const paid =
    (nowYm.year - firstYm.year) * 12 + (nowYm.month - firstYm.month) + 1;
  return `${Math.max(0, paid)} / ${totalLabel}`;
}
