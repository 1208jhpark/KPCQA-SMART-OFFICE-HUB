/**
 * 활성(보유) 장비 판정 — 목록·대시보드 카운트 공통
 * - status === '정상'
 * - archived_at 없음
 * - 부분 폐기 분리 건(_ARC_) 제외
 * - 품목명 없는 미완성/임시 등록 제외
 * - TMP- 임시 자산번호 제외
 */
export function isActiveEquipmentRow(eq: {
  status?: string | null;
  archived_at?: string | Date | null;
  asset_no?: string | null;
  name?: string | null;
} | null | undefined): boolean {
  if (!eq) return false;
  if (String(eq.status || '').trim() !== '정상') return false;
  if (eq.archived_at) return false;
  const assetNo = String(eq.asset_no || '').trim();
  if (assetNo.includes('_ARC_')) return false;
  if (/^TMP-/i.test(assetNo)) return false;
  if (!String(eq.name || '').trim()) return false;
  return true;
}

/** 폐기/반납함 판정 (미완성 정상 행은 여기 넣지 않음) */
export function isArchivedEquipmentRow(eq: {
  status?: string | null;
  archived_at?: string | Date | null;
  asset_no?: string | null;
} | null | undefined): boolean {
  if (!eq) return false;
  if (String(eq.asset_no || '').includes('_ARC_')) return true;
  if (eq.archived_at) return true;
  return String(eq.status || '').trim() !== '정상';
}

export function equipmentActiveQty(eq: { qty?: number | null } | null | undefined): number {
  const n = Number(eq?.qty);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
