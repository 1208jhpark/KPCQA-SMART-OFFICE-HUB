import { isCustomerDirectShip } from '@/lib/production-shipping';

/** 제작물 신청 공정 상태 — 접수대기 → 발주대기 → 발주완료 → 수령완료 */
export const PRODUCTION_STATUS = {
  /** 신청 접수 전 (부서원 신청 직후) */
  PENDING: 'PENDING',
  /** 접수 완료 · 발주확정 전 */
  ACCEPTED: 'ACCEPTED',
  /** 묶음 편성 후 (발주확정 전=발주대기, 발주확정 후=발주완료) */
  ORDERED: 'ORDERED',
  /** 수령확인 완료 (고객사 직발송은 발주확정 시 완료이력으로 이동) */
  VERIFIED: 'VERIFIED',
  /** 부서 반려 */
  REJECTED: 'REJECTED',
  /** 신청자 취소 */
  CANCELLED: 'CANCELLED',
} as const;

export type ProductionStatusCode =
  (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

/** 공정상태(또는 UI상 동등 전환) 변경 시 data에 합칠 스탬프 */
export function productionStatusChangedStamp(at: Date = new Date()) {
  return { statusChangedAt: at };
}

function isVendorDispatched(options?: Record<string, unknown> | null): boolean {
  return Boolean(options && (options as { vendorDispatched?: unknown }).vendorDispatched === true);
}

/** ACCEPTED, 또는 묶음 편성(ORDERED) 후 발주확정 전 — 화면 라벨은 묶음발주대기 */
export function isProductionWaitOrder(
  status: string,
  options?: Record<string, unknown> | null
): boolean {
  if (status === PRODUCTION_STATUS.ACCEPTED) return true;
  if (status === PRODUCTION_STATUS.ORDERED && !isVendorDispatched(options)) return true;
  return false;
}

/** 신청자 이력에서 원문 수정 가능 (신청대기·묶음발주대기·반려) */
export function canEditProductionApplicantSource(
  status: string,
  options?: Record<string, unknown> | null
): boolean {
  if (status === PRODUCTION_STATUS.PENDING) return true;
  if (status === PRODUCTION_STATUS.REJECTED) return true;
  return isProductionWaitOrder(status, options);
}

function isDirectShipVerified(
  status: string,
  options?: Record<string, unknown> | null,
  category?: string
): boolean {
  return (
    status === PRODUCTION_STATUS.VERIFIED &&
    isCustomerDirectShip({ category, options })
  );
}

/**
 * 공정상태 라벨 톤
 * - ops: 검수·정산 등 운영 화면 (접수대기 / 발주대기)
 * - applicant: 나의 이력·부서 전체 이력 (신청대기 / 묶음발주대기)
 * - deptQueue: 부서 발주 대장 신청검수·묶음발주대기 (신청검수 / 묶음발주대기)
 */
export type ProductionStatusLabelVariant = 'ops' | 'applicant' | 'deptQueue';

/**
 * 화면 공정상태 라벨
 * PENDING → 접수대기 | 신청대기 | 신청검수
 * ACCEPTED / ORDERED(미발주확정) → 발주대기 | 묶음발주대기
 * ORDERED(발주확정) → 발주완료
 * VERIFIED(고객사 직발송) → 발주완료(고객사직발송)
 * VERIFIED(인증원 수령) → 수령완료
 */
export function productionStatusLabel(
  status: string,
  options?: Record<string, unknown> | null,
  variant: ProductionStatusLabelVariant = 'ops',
  category?: string
): string {
  const pendingLabel =
    variant === 'deptQueue' ? '신청검토' : variant === 'applicant' ? '신청대기' : '접수대기';
  const waitOrderLabel =
    variant === 'deptQueue' || variant === 'applicant' ? '묶음발주대기' : '발주대기';

  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return pendingLabel;
    case PRODUCTION_STATUS.ACCEPTED:
      return waitOrderLabel;
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? '발주완료' : waitOrderLabel;
    case PRODUCTION_STATUS.VERIFIED:
      return isDirectShipVerified(status, options, category)
        ? '발주완료(고객사직발송)'
        : '수령완료';
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
  options?: Record<string, unknown> | null,
  category?: string
): string {
  switch (status) {
    case PRODUCTION_STATUS.PENDING:
      return 'text-orange-600';
    case PRODUCTION_STATUS.ACCEPTED:
      return 'text-blue-600';
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? 'text-emerald-700' : 'text-blue-600';
    case PRODUCTION_STATUS.VERIFIED:
      return isDirectShipVerified(status, options, category)
        ? 'text-emerald-700 font-bold'
        : 'text-slate-900 font-bold';
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
  options?: Record<string, unknown> | null,
  category?: string
): string {
  switch (status) {
    case PRODUCTION_STATUS.ACCEPTED:
      return '발주 대기';
    case PRODUCTION_STATUS.ORDERED:
      return isVendorDispatched(options) ? '발주 완료' : '발주 대기';
    case PRODUCTION_STATUS.VERIFIED:
      return isDirectShipVerified(status, options, category)
        ? '발주완료(고객사직발송)'
        : '완료';
    case PRODUCTION_STATUS.REJECTED:
      return '반려됨';
    case PRODUCTION_STATUS.CANCELLED:
      return '취소됨';
    default:
      return '-';
  }
}
