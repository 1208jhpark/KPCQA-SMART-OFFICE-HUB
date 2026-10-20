/**
 * 명함 adminStatus(DB) → 화면 공정상태 라벨
 * DB: 대기중 / 접수완료 / 발주완료 / 수령완료 / 지급완료 / 반려
 */
export function formatBusinessCardAdminStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (s === '대기중') return '신청검수';
  if (s === '접수완료') return '묶음발주대기';
  if (s === '수령완료') return '지급대기';
  return s || '-';
}

/**
 * 신청자(my-page)용 공정상태 라벨
 * - 대기중 → 신청대기 (신청자 관점; 마스터는 신청검수)
 * - 발주완료 → 발주중
 * - 발주완료 + 시안 업로드·미확정 → 시안 검수요청
 * - 수령완료 → 수령대기 (사무실 도착 후 찾아가기)
 * - 지급완료 → 수령완료 (관리자 지급 = 사용자 수령)
 */
export function formatBusinessCardUserStatusLabel(
  status: string | null | undefined,
  opts?: { hasProof?: boolean; proofConfirmed?: boolean }
): string {
  const s = String(status || '').trim();
  if (s === '대기중') return '신청대기';
  if (s === '접수완료') return '발주대기';
  if (s === '발주완료') {
    const hasProof = Boolean(opts?.hasProof);
    const confirmed = Boolean(opts?.proofConfirmed);
    if (hasProof && !confirmed) return '시안 검수요청';
    return '발주중';
  }
  if (s === '수령완료') return '수령대기';
  if (s === '지급완료') return '수령완료';
  return s || '-';
}

/** 신청자 관점: 신청대기(대기중) — hub 나의 신청대기 */
export function isBusinessCardUserApplyPending(status: string | null | undefined): boolean {
  return String(status || '').trim() === '대기중';
}

/** 신청자 관점: 수령대기 — 사무실 수령 후·지급 전 (hub·홈알람과 동일) */
export function isBusinessCardUserReadyPickup(status: string | null | undefined): boolean {
  return String(status || '').trim() === '수령완료';
}

/** 신청자 관점: 시안 검수요청 — 시안 업로드됨·미확정 (홈알람과 동일) */
export function isBusinessCardUserProofReviewPending(row: {
  adminStatus?: string | null;
  proofFileName?: string | null;
  proofConfirmedAt?: string | Date | null;
  hasProof?: boolean;
  proofConfirmed?: boolean;
}): boolean {
  if (String(row.adminStatus || '').trim() !== '발주완료') return false;
  const hasProof = Boolean(row.hasProof || row.proofFileName);
  const confirmed = Boolean(row.proofConfirmed || row.proofConfirmedAt);
  return hasProof && !confirmed;
}
