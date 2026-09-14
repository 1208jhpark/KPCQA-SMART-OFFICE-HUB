/**
 * 기타제작(PRINT) 주문물품 시드 기본값
 * (seed-production-masters / 시드 항목 복구와 동일 기준).
 * - 복구 시: 없으면 생성, 비활성만 재활성. 기존 명칭·규격·공급처 등은 덮어쓰지 않음.
 */
export const SEED_PRINT_ITEM_DEFAULTS = [
  {
    id: 'PRINT_CERT_PAPER',
    name: '인증서 용지',
    size: 'A4',
    supplier: '아트로릭',
    orderQty: 300,
    unitValue: 'VAL_1',
    isCustom: false,
    sortOrder: 10,
  },
  {
    id: 'PRINT_CERT_HOLDER',
    name: '인증서 홀더',
    size: 'A4',
    supplier: '아트로릭',
    orderQty: 1,
    unitValue: 'VAL_1',
    isCustom: false,
    sortOrder: 15,
  },
  {
    id: 'PRINT_BAG_M',
    name: '쇼핑백(중)',
    size: '230*70*320',
    supplier: '한생미디어',
    orderQty: 2000,
    unitValue: 'VAL_6',
    isCustom: false,
    sortOrder: 20,
  },
  {
    id: 'PRINT_BAG_L',
    name: '쇼핑백(대)',
    size: '300*100*450',
    supplier: '한생미디어',
    orderQty: 2000,
    unitValue: 'VAL_6',
    isCustom: false,
    sortOrder: 30,
  },
  {
    id: 'PRINT_AWARD_CASE',
    name: '상장케이스',
    size: 'A4',
    supplier: '한생미디어',
    orderQty: 600,
    unitValue: 'VAL_1',
    isCustom: false,
    sortOrder: 40,
  },
  {
    id: 'PRINT_COLOR_ENVELOPE',
    name: '컬러대봉투(양면테잎)',
    size: '330*245',
    supplier: '아트로릭',
    orderQty: 3000,
    unitValue: 'VAL_8',
    isCustom: false,
    sortOrder: 50,
  },
  {
    id: 'PRINT_CONDOLENCE_ENVELOPE_CHUK',
    name: '경조사봉투(축의)',
    size: '기본',
    supplier: '드림디포',
    orderQty: 200,
    unitValue: 'VAL_8',
    isCustom: false,
    sortOrder: 60,
  },
  {
    id: 'PRINT_CONDOLENCE_ENVELOPE_JO',
    name: '경조사봉투(조의)',
    size: '기본',
    supplier: '드림디포',
    orderQty: 200,
    unitValue: 'VAL_8',
    isCustom: false,
    sortOrder: 61,
  },
] as const;

export const SEED_PRINT_ITEM_IDS = SEED_PRINT_ITEM_DEFAULTS.map((i) => i.id);

export function isSeedPrintItemId(id: string): boolean {
  return (SEED_PRINT_ITEM_IDS as readonly string[]).includes(id);
}
