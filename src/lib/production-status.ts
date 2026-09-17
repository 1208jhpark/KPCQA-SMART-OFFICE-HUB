/** 제작물 신청 공정 상태 — 접수대기 → 발주대기 → 수령대기 → 수령완료 */
export const PRODUCTION_STATUS = {
  /** 신청 접수 전 (부서원 신청 직후) */
  PENDING: 'PENDING',
  /** 접수 완료 · 발주확정 전 */
  ACCEPTED: 'ACCEPTED',
  /** 묶음 편성 후 (발주확정 전=발주대기, 발주확정 후=수령대기) */
  ORDERED: 'ORDERED',
  /** 수령확인 완료 */
  VERIFIED: 'VERIFIED',
  /** 부서 반려 */
  REJECTED: 'REJECTED',
  /** 신청자 취소 */
  CANCELLED: 'CANCELLED',
} as const;

export type ProductionStatusCode =
  (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

function isVendorDispatched(options?: Record<string, unknown> | null): boolean {
  return Boolean(options && (options as { vendorDispatched?: unknown }).vendorDispatched === true);
}

/**
 * 화면 공정상태 라벨 (4단계)
 * PENDING → 접수대기
 * ACCEPTED / ORDERED(미발주확정) → 발주대기
 * ORDERED(발주확정) → 수령대기
 * VERIFIED → 수령완료
 */
export function productionStatusLabel(
  status: string,
  options?: Record<string, unknown> | null
): string {
  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return '접수대기';
    case PRODUCTION_STATUS.ACCEPTED:
      return '발주대기';
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? '수령대기' : '발주대기';
    case PRODUCTION_STATUS.VERIFIED:
      return '수령완료';
    case PRODUCTION_STATUS.REJECTED:
      return '반려';
    case PRODUCTION_STATUS.CANCELLED:
      return '취소됨';
    default:
      return status || '-';
  }
}

/** businesscard/master/requests 공정상태 색상 톤 */
export function productionStatusTextClass(
  status: string,
  options?: Record<string, unknown> | null
): string {
  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return 'text-orange-600';
    case PRODUCTION_STATUS.ACCEPTED:
      return 'text-blue-600';
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? 'text-teal-700' : 'text-blue-600';
    case PRODUCTION_STATUS.VERIFIED:
      return 'text-slate-900 font-bold';
    case PRODUCTION_STATUS.REJECTED:
      return 'text-red-600';
    case PRODUCTION_STATUS.CANCELLED:
      return 'text-slate-400';
    default:
      return 'text-slate-500';
  }
}

export function productionActionHint(
  status: string,
  options?: Record<string, unknown> | null
): string {
  switch (status) {
    case PRODUCTION_STATUS.ACCEPTED:
      return '발주 대기';
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? '수령 대기' : '발주 대기';
    case PRODUCTION_STATUS.VERIFIED:
      return '완료';
    case PRODUCTION_STATUS.REJECTED:
      return '반려됨';
    case PRODUCTION_STATUS.CANCELLED:
      return '취소됨';
    default:
      return '-';
  }
}
