/** 제작물 신청 공정 상태 — dept-master 접수→발주→검수 동선 */
export const PRODUCTION_STATUS = {
  /** 신청 접수 전 (부서원 신청 직후) */
  PENDING: 'PENDING',
  /** 접수 완료 · 묶음 발주 대기 */
  ACCEPTED: 'ACCEPTED',
  /** 묶음 발주 완료 · 명세서 검수 대상 */
  ORDERED: 'ORDERED',
  /** 명세 대조·정산 승인 */
  VERIFIED: 'VERIFIED',
  /** 부서 반려 */
  REJECTED: 'REJECTED',
  /** 신청자 취소 */
  CANCELLED: 'CANCELLED',
} as const;

export type ProductionStatusCode =
  (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

export function productionStatusLabel(status: string): string {
  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return '대기중';
    case PRODUCTION_STATUS.ACCEPTED:
      return '발주대기';
    case PRODUCTION_STATUS.ORDERED:
      return '발주완료';
    case PRODUCTION_STATUS.VERIFIED:
      return '정산승인';
    case PRODUCTION_STATUS.REJECTED:
      return '반려';
    case PRODUCTION_STATUS.CANCELLED:
      return '취소됨';
    default:
      return status || '-';
  }
}

/** businesscard/master/requests 공정상태 색상 톤 */
export function productionStatusTextClass(status: string): string {
  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return 'text-orange-600';
    case PRODUCTION_STATUS.ACCEPTED:
      return 'text-blue-600';
    case PRODUCTION_STATUS.ORDERED:
      return 'text-emerald-600';
    case PRODUCTION_STATUS.VERIFIED:
      return 'text-purple-700';
    case PRODUCTION_STATUS.REJECTED:
      return 'text-red-600';
    case PRODUCTION_STATUS.CANCELLED:
      return 'text-slate-400';
    default:
      return 'text-slate-500';
  }
}

export function productionActionHint(status: string): string {
  switch (status) {
    case PRODUCTION_STATUS.ACCEPTED:
      return '발주 대기';
    case PRODUCTION_STATUS.ORDERED:
      return '명세 검수 대기';
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
