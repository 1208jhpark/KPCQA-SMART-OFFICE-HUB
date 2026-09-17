/** 소모품 신청(SupplyRequest) status — DB/API는 영어, UI만 한글 */

export const SUPPLY_REQUEST_STATUS = {
  PENDING: 'PENDING',
  /** 지급승인 후 · 사용자 수령 대기 */
  READY: 'READY',
  /** 지급완료(최종) */
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type SupplyRequestStatus =
  (typeof SUPPLY_REQUEST_STATUS)[keyof typeof SUPPLY_REQUEST_STATUS];

const KO_TO_EN: Record<string, SupplyRequestStatus> = {
  대기중: 'PENDING',
  대기: 'PENDING',
  수령대기: 'READY',
  지급대기: 'READY',
  지급승인: 'READY',
  지급완료: 'COMPLETED',
  수령완료: 'COMPLETED', // 레거시·부서 표기
  반려: 'REJECTED',
  취소: 'CANCELLED',
  신청취소: 'CANCELLED',
};

const EN_LABEL: Record<SupplyRequestStatus, string> = {
  PENDING: '대기중',
  READY: '지급대기',
  COMPLETED: '지급완료',
  REJECTED: '반려',
  CANCELLED: '취소',
};

/** 구 한글 값·영문 값을 표준 영문으로 정규화. 실패 시 null */
export function normalizeSupplyRequestStatus(
  raw: unknown
): SupplyRequestStatus | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (
    s === 'PENDING' ||
    s === 'READY' ||
    s === 'COMPLETED' ||
    s === 'REJECTED' ||
    s === 'CANCELLED'
  ) {
    return s;
  }
  return KO_TO_EN[s] ?? null;
}

/** UI/엑셀 표시용 한글 라벨 (마스터: 지급완료) */
export function supplyRequestStatusLabel(raw: unknown): string {
  const en = normalizeSupplyRequestStatus(raw);
  return en ? EN_LABEL[en] : '-';
}

/** 부서(신청자) 화면용 — READY→수령대기, COMPLETED→수령완료 */
export function supplyRequestStatusLabelDept(raw: unknown): string {
  const en = normalizeSupplyRequestStatus(raw);
  if (!en) return '-';
  if (en === 'READY') return '수령대기';
  if (en === 'COMPLETED') return '수령완료';
  return EN_LABEL[en];
}

export function isSupplyRequestStatus(
  raw: unknown,
  target: SupplyRequestStatus
): boolean {
  return normalizeSupplyRequestStatus(raw) === target;
}

export function isPendingSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'PENDING');
}

export function isReadySupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'READY');
}

export function isCompletedSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'COMPLETED');
}

export function isRejectedSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'REJECTED');
}

export function isCancelledSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'CANCELLED');
}

/** 반려 또는 신청자 취소 (종료·비지급) */
export function isClosedNegativeSupplyRequest(raw: unknown) {
  const s = normalizeSupplyRequestStatus(raw);
  return s === 'REJECTED' || s === 'CANCELLED';
}

/** 선차감 재고가 빠져 있는 상태 (대기·수령대기·지급완료) */
export function isStockOutSupplyRequest(raw: unknown) {
  const s = normalizeSupplyRequestStatus(raw);
  return s === 'PENDING' || s === 'READY' || s === 'COMPLETED';
}

/**
 * 마스터 신청 대장 PATCH 허용 전이
 * PENDING → READY | COMPLETED | REJECTED
 * READY → COMPLETED | REJECTED
 * COMPLETED / REJECTED / CANCELLED → 불가 (CANCELLED는 부서 신청취소 전용)
 */
const MASTER_ALLOWED_TRANSITIONS: Record<SupplyRequestStatus, SupplyRequestStatus[]> = {
  PENDING: ['READY', 'COMPLETED', 'REJECTED'],
  READY: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canMasterTransitionSupplyStatus(
  from: SupplyRequestStatus | null | undefined,
  to: SupplyRequestStatus | null | undefined
): boolean {
  if (!from || !to) return false;
  if (from === to) return true;
  return (MASTER_ALLOWED_TRANSITIONS[from] || []).includes(to);
}
