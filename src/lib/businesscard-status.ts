/**
 * 명함 adminStatus(DB) → 화면 공정상태 라벨
 * DB: 대기중 / 접수완료 / 발주완료 / 지급완료 / 반려
 */
export function formatBusinessCardAdminStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (s === '대기중') return '접수대기';
  if (s === '접수완료') return '발주대기';
  return s || '-';
}
