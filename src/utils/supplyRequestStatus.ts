/** 소모품 신청(SupplyRequest) status — DB/API는 영어, UI만 한글 */

export const SUPPLY_REQUEST_STATUS = {
  PENDING: 'PENDING',
  /** @deprecated 지급대기 단계 폐지 — 잔여건만 마스터에서 지급완료/반려 */
  READY: 'READY',
  /** 지급완료(최종) — 마스터 지급승인 */
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type SupplyRequestStatus =
  (typeof SUPPLY_REQUEST_STATUS)[keyof typeof SUPPLY_REQUEST_STATUS];

const KO_TO_EN: Record<string, SupplyRequestStatus> = {
  대기중: 'PENDING',
  대기: 'PENDING',
  신규대기: 'PENDING',
  접수대기: 'PENDING',
  수령대기: 'READY',
  지급대기: 'READY',
  지급승인: 'READY',
  지급완료: 'COMPLETED',
  수령완료: 'COMPLETED', // 레거시·부서 표기
  반려: 'REJECTED', // 레거시 표기
  취소: 'REJECTED', // 마스터 취소 처리 (마케팅 취소와 동일 계열)
  신청취소: 'CANCELLED',
};

const EN_LABEL: Record<SupplyRequestStatus, string> = {
  PENDING: '접수대기',
  /** 레거시 잔여건 — UI는 접수대기로 통일 */
  READY: '접수대기',
  COMPLETED: '지급완료',
  /** 마스터 취소 처리 — 마케팅 기념품「취소」표기와 동일 */
  REJECTED: '취소',
  CANCELLED: '신청취소',
};

/** 알람·대기건수 집계용 (영문 + 구 한글) */
export const SUPPLY_REQUEST_PENDING_STATUSES = [
  'PENDING',
  '대기중',
  '대기',
  '신규대기',
] as const;

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

/** 부서(신청자) 화면용 — PENDING·READY→지급대기, REJECTED→취소(+사유는 admin_opinion) */
export function supplyRequestStatusLabelDept(raw: unknown): string {
  const en = normalizeSupplyRequestStatus(raw);
  if (!en) return '-';
  if (en === 'PENDING' || en === 'READY') return '지급대기';
  if (en === 'COMPLETED') return '지급완료';
  if (en === 'REJECTED') return '취소';
  if (en === 'CANCELLED') return '신청취소';
  return EN_LABEL[en];
}

/** 부서 화면: 마스터 처리 전(PENDING) + 과거 READY 잔여 = 지급대기 */
export function isWaitingSupplyRequest(raw: unknown) {
  const en = normalizeSupplyRequestStatus(raw);
  return en === 'PENDING' || en === 'READY';
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
 * PENDING → COMPLETED | REJECTED  (지급승인 = 즉시 지급완료)
 * READY → COMPLETED | REJECTED    (과거 지급대기 잔여건 정리용)
 * COMPLETED / REJECTED / CANCELLED → 불가 (CANCELLED는 부서 신청취소 전용)
 */
const MASTER_ALLOWED_TRANSITIONS: Record<SupplyRequestStatus, SupplyRequestStatus[]> = {
  PENDING: ['COMPLETED', 'REJECTED'],
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
