/**
 * 명함 adminStatus(DB) → 화면 공정상태 라벨
 * DB: 대기중 / 접수완료 / 발주완료 / 수령완료 / 지급완료 / 반려
 */
export function formatBusinessCardAdminStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (s === '대기중') return '접수대기';
  if (s === '접수완료') return '발주대기';
  if (s === '수령완료') return '지급대기';
  return s || '-';
}

/**
 * 신청자(my-page)용 공정상태 라벨
 * - 발주완료 → 제작중 (외주 제작·배송 중, 관리자 수령 전)
 * - 수령완료 → 수령대기 (사무실 도착 후 찾아가기)
 * - 지급완료 → 수령완료 (관리자 지급 = 사용자 수령)
 */
export function formatBusinessCardUserStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (s === '대기중') return '접수대기';
  if (s === '접수완료') return '발주대기';
  if (s === '발주완료') return '제작중';
  if (s === '수령완료') return '수령대기';
  if (s === '지급완료') return '수령완료';
  return s || '-';
}

/** 신청자 관점: 접수대기(대기중) — hub 나의 신청대기 */
export function isBusinessCardUserApplyPending(status: string | null | undefined): boolean {
  return String(status || '').trim() === '대기중';
}

/** 신청자 관점: 수령대기 — 사무실 수령 후·지급 전 (hub·홈알람과 동일) */
export function isBusinessCardUserReadyPickup(status: string | null | undefined): boolean {
  return String(status || '').trim() === '수령완료';
}
