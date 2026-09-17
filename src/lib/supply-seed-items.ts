/**
 * 소모품(경영) 창고 품목 시드 기본값
 * (prisma/seed.ts GRP_SUPPLY 라벨과 동일 · 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 단위·비고·재고는 덮어쓰지 않음.
 * - 현재고·안전재고(alert_qty)는 기본 0 (운영에서 입고·수정으로 맞춤).
 */
export const SEED_SUPPLY_ITEM_DEFAULTS = [
  {
    id: 'SUPPLY_A4',
    name: 'A4 용지',
    owner_dept: 'KPCQA',
    s_unit: '번들(BDL)',
    note: '드림디포 박스단위 구매',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 10,
  },
  {
    id: 'SUPPLY_A3',
    name: 'A3 용지',
    owner_dept: 'KPCQA',
    s_unit: '번들(BDL)',
    note: '드림디포 박스단위 구매',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 20,
  },
  {
    id: 'SUPPLY_AWARD_CASE',
    name: '상장케이스',
    owner_dept: 'KPCQA',
    s_unit: '개(EA)',
    note: '한생미디어(제작주문600개)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 30,
  },
  {
    id: 'SUPPLY_COLOR_ENVELOPE',
    name: '컬러대봉투(양면테이프) /330×245',
    owner_dept: 'KPCQA',
    s_unit: '장(Sheet)',
    note: '아트로릭(제작주문3000장)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 40,
  },
  {
    id: 'SUPPLY_BAG_M',
    name: '쇼핑백(중) /230×70×320',
    owner_dept: 'KPCQA',
    s_unit: '부(Copy)',
    note: '한생미디어(제작주문2000부)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 50,
  },
  {
    id: 'SUPPLY_BAG_L',
    name: '쇼핑백(대) /300×100×450',
    owner_dept: 'KPCQA',
    s_unit: '부(Copy)',
    note: '한생미디어(제작주문2000부)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 60,
  },
  {
    id: 'SUPPLY_CONDOLENCE_CHUK',
    name: '경조사봉투(축의)',
    owner_dept: 'KPCQA',
    s_unit: '장(Sheet)',
    note: '드림디포(주문200장)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 70,
  },
  {
    id: 'SUPPLY_CONDOLENCE_JO',
    name: '경조사봉투(조의)',
    owner_dept: 'KPCQA',
    s_unit: '장(Sheet)',
    note: '드림디포(주문200장)',
    publish_note: '',
    current_stock: 0,
    alert_qty: 0,
    category: '일반',
    sortOrder: 80,
  },
] as const;

export const SEED_SUPPLY_ITEM_IDS = SEED_SUPPLY_ITEM_DEFAULTS.map((i) => i.id);

export function isSeedSupplyItemId(id: string): boolean {
  return (SEED_SUPPLY_ITEM_IDS as readonly string[]).includes(id);
}
