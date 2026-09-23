/**
 * 제작 외주업체(VENDOR) 시드 기본값
 * (migration seed_vend_* / seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 명칭·연락처·품목·우선연결은 덮어쓰지 않음.
 * - 식별: 고정 id 또는 업체명(label) — 과거 cuid 생성분도 시드로 취급.
 * - 구 시드 `한생미디어`(통합)는 삭제 보호만 유지 (신규 시드는 3종 분리).
 */
export const SEED_VENDOR_DEFAULTS = [
  {
    id: 'seed_vend_artrolic',
    label: '아트로릭',
    managerName: '',
    contact: '',
    email: 'song@artroric.com',
    items: '인증서용지, 컬러대봉투, 현판',
    priorityCategory: 'SIGN',
  },
  {
    id: 'seed_vend_hanseng_case',
    label: '한생미디어(상장케이스)',
    managerName: '',
    contact: '',
    email: 'jhylee@kpcm.or.kr',
    items: '상장케이스',
    priorityCategory: '',
  },
  {
    id: 'seed_vend_hanseng_jebon',
    label: '한생미디어(제본)',
    managerName: '',
    contact: '',
    email: 'kskim@kpcm.or.kr, jhseok@kpcm.or.kr',
    items: '제본',
    priorityCategory: 'JEBON',
  },
  {
    id: 'seed_vend_hanseng_bag',
    label: '한생미디어(쇼핑백, 달력)',
    managerName: '',
    contact: '',
    email: 'kskim@kpcm.or.kr',
    items: '쇼핑백, 달력',
    priorityCategory: '',
  },
  {
    id: 'seed_vend_dreamdepot',
    label: '드림디포',
    managerName: '',
    contact: '',
    email: 'dream7395@naver.com',
    items: '경조사봉투, 사무문구',
    priorityCategory: 'OFFICE_SUPPLIES',
  },
] as const;

/** 구 통합 시드 — 목록에 남아 있어도 LV_1 삭제 보호 */
const LEGACY_SEED_VENDOR_IDS = ['seed_vend_hanseng'] as const;
const LEGACY_SEED_VENDOR_LABELS = ['한생미디어', '한생미디어(쇼핑백)'] as const;

export const SEED_VENDOR_IDS = SEED_VENDOR_DEFAULTS.map((v) => v.id);
export const SEED_VENDOR_LABELS = SEED_VENDOR_DEFAULTS.map((v) => v.label);

export function isSeedVendorId(id: string): boolean {
  const t = String(id || '').trim();
  return (
    (SEED_VENDOR_IDS as readonly string[]).includes(t) ||
    (LEGACY_SEED_VENDOR_IDS as readonly string[]).includes(t)
  );
}

export function isSeedVendorLabel(label: string): boolean {
  const t = String(label || '').trim();
  return (
    (SEED_VENDOR_LABELS as readonly string[]).includes(t) ||
    (LEGACY_SEED_VENDOR_LABELS as readonly string[]).includes(t)
  );
}

/** id 또는 업체명으로 시드 여부 판별 */
export function isSeedVendor(row: { id?: string; label?: string }): boolean {
  if (row.id && isSeedVendorId(row.id)) return true;
  if (row.label && isSeedVendorLabel(row.label)) return true;
  return false;
}
