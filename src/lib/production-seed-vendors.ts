/**
 * 제작 외주업체(VENDOR) 시드 기본값
 * (migration seed_vend_* / seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 명칭·연락처·품목·우선연결은 덮어쓰지 않음.
 * - 식별: 고정 id 또는 업체명(label) — 과거 cuid 생성분도 시드로 취급.
 */
export const SEED_VENDOR_DEFAULTS = [
  {
    id: 'seed_vend_artrolic',
    label: '아트로릭',
    managerName: '',
    contact: '',
    email: '',
    items: '인증서용지, 컬러대봉투, 현판',
    priorityCategory: 'SIGN',
  },
  {
    id: 'seed_vend_hanseng',
    label: '한생미디어',
    managerName: '',
    contact: '',
    email: '',
    items: '제본, 쇼핑백, 상장케이스',
    priorityCategory: 'JEBON',
  },
  {
    id: 'seed_vend_dreamdepot',
    label: '드림디포',
    managerName: '',
    contact: '',
    email: '',
    items: '경조사봉투, 사무문구',
    priorityCategory: 'OFFICE_SUPPLIES',
  },
] as const;

export const SEED_VENDOR_IDS = SEED_VENDOR_DEFAULTS.map((v) => v.id);
export const SEED_VENDOR_LABELS = SEED_VENDOR_DEFAULTS.map((v) => v.label);

export function isSeedVendorId(id: string): boolean {
  return (SEED_VENDOR_IDS as readonly string[]).includes(id);
}

export function isSeedVendorLabel(label: string): boolean {
  const t = String(label || '').trim();
  return (SEED_VENDOR_LABELS as readonly string[]).includes(t);
}

/** id 또는 업체명으로 시드 여부 판별 */
export function isSeedVendor(row: { id?: string; label?: string }): boolean {
  if (row.id && isSeedVendorId(row.id)) return true;
  if (row.label && isSeedVendorLabel(row.label)) return true;
  return false;
}
