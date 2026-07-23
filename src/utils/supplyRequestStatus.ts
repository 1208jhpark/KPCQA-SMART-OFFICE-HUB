/** 소모품 신청(SupplyRequest) status — DB/API는 영어, UI만 한글 */

export const SUPPLY_REQUEST_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
} as const;

export type SupplyRequestStatus =
  (typeof SUPPLY_REQUEST_STATUS)[keyof typeof SUPPLY_REQUEST_STATUS];

const KO_TO_EN: Record<string, SupplyRequestStatus> = {
  대기중: 'PENDING',
  대기: 'PENDING',
  지급완료: 'COMPLETED',
  반려: 'REJECTED',
};

const EN_LABEL: Record<SupplyRequestStatus, string> = {
  PENDING: '대기중',
  COMPLETED: '지급완료',
  REJECTED: '반려',
};

/** 구 한글 값·영문 값을 표준 영문으로 정규화. 실패 시 null */
export function normalizeSupplyRequestStatus(
  raw: unknown
): SupplyRequestStatus | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s === 'PENDING' || s === 'COMPLETED' || s === 'REJECTED') return s;
  return KO_TO_EN[s] ?? null;
}

/** UI/엑셀 표시용 한글 라벨 */
export function supplyRequestStatusLabel(raw: unknown): string {
  const en = normalizeSupplyRequestStatus(raw);
  return en ? EN_LABEL[en] : '-';
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

export function isCompletedSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'COMPLETED');
}

export function isRejectedSupplyRequest(raw: unknown) {
  return isSupplyRequestStatus(raw, 'REJECTED');
}

/** 선차감 재고가 빠져 있는 상태 (대기·지급완료) */
export function isStockOutSupplyRequest(raw: unknown) {
  const s = normalizeSupplyRequestStatus(raw);
  return s === 'PENDING' || s === 'COMPLETED';
}
