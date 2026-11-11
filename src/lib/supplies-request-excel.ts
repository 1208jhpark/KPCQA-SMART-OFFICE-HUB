import { writeGroupedOrderExcelBuffer } from '@/lib/production-sign-excel';

/** 명함 발주서와 동일한 3톤 그룹 헤더 */
const APPLY_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const PROCESS_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const SUPPLIES_COMPLETED_REQUEST_HEADERS = [
  'NO',
  '신청일시',
  '소속조직',
  '신청자',
  '물품명',
  '신청수량',
  '신청자 특이요청 사항',
  '처리자',
  '처리일시',
  '상태',
  '취소사유',
] as const;

export type SuppliesCompletedRequestHeader =
  (typeof SUPPLIES_COMPLETED_REQUEST_HEADERS)[number];

const SUPPLIES_COMPLETED_REQUEST_GROUPS = [
  {
    label: '신청정보',
    keys: [
      '신청일시',
      '소속조직',
      '신청자',
      '물품명',
      '신청수량',
      '신청자 특이요청 사항',
    ] as SuppliesCompletedRequestHeader[],
    ...APPLY_COLORS,
  },
  {
    label: '처리정보',
    keys: ['처리자', '처리일시', '상태', '취소사유'] as SuppliesCompletedRequestHeader[],
    ...PROCESS_COLORS,
  },
];

const SUPPLIES_COMPLETED_CENTER_KEYS = new Set<SuppliesCompletedRequestHeader>([
  'NO',
  '신청일시',
  '신청수량',
  '처리일시',
  '상태',
]);

export type SuppliesCompletedRequestExcelRow = Record<
  SuppliesCompletedRequestHeader,
  string | number
>;

/** 소모품 처리완료 내역 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeSuppliesCompletedRequestExcelBuffer(
  rows: SuppliesCompletedRequestExcelRow[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '처리완료내역',
    headers: SUPPLIES_COMPLETED_REQUEST_HEADERS,
    groups: SUPPLIES_COMPLETED_REQUEST_GROUPS,
    rows,
    centerKeys: SUPPLIES_COMPLETED_CENTER_KEYS,
  });
}

const STOCK_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const REG_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const SUPPLIES_RESTOCK_HEADERS = [
  'NO',
  '창고 입고일',
  '물품명',
  '입고수량',
  '입고단위',
  '환산수량 (지급/입고)',
  '환산 입고수량',
  '지급단위',
  '등록자',
  '소속부서',
] as const;

export type SuppliesRestockHeader = (typeof SUPPLIES_RESTOCK_HEADERS)[number];

const SUPPLIES_RESTOCK_GROUPS = [
  {
    label: '입고정보',
    keys: [
      '창고 입고일',
      '물품명',
      '입고수량',
      '입고단위',
      '환산수량 (지급/입고)',
      '환산 입고수량',
      '지급단위',
    ] as SuppliesRestockHeader[],
    ...STOCK_COLORS,
  },
  {
    label: '등록정보',
    keys: ['등록자', '소속부서'] as SuppliesRestockHeader[],
    ...REG_COLORS,
  },
];

const SUPPLIES_RESTOCK_CENTER_KEYS = new Set<SuppliesRestockHeader>([
  'NO',
  '창고 입고일',
  '입고수량',
  '환산수량 (지급/입고)',
  '환산 입고수량',
]);

export type SuppliesRestockExcelRow = Record<SuppliesRestockHeader, string | number>;

/** 소모품 입고대장 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeSuppliesRestockExcelBuffer(
  rows: SuppliesRestockExcelRow[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '입고대장',
    headers: SUPPLIES_RESTOCK_HEADERS,
    groups: SUPPLIES_RESTOCK_GROUPS,
    rows,
    centerKeys: SUPPLIES_RESTOCK_CENTER_KEYS,
  });
}

export const SUPPLIES_ARCHIVE_HEADERS = [
  'NO',
  '폐기 처리일',
  '물품명',
  '최종 재고',
  '폐기 사유 (비고)',
  '처리자 이름',
  '처리자 부서',
] as const;

export type SuppliesArchiveHeader = (typeof SUPPLIES_ARCHIVE_HEADERS)[number];

const SUPPLIES_ARCHIVE_GROUPS = [
  {
    label: '폐기정보',
    keys: [
      '폐기 처리일',
      '물품명',
      '최종 재고',
      '폐기 사유 (비고)',
    ] as SuppliesArchiveHeader[],
    ...STOCK_COLORS,
  },
  {
    label: '처리자정보',
    keys: ['처리자 이름', '처리자 부서'] as SuppliesArchiveHeader[],
    ...REG_COLORS,
  },
];

const SUPPLIES_ARCHIVE_CENTER_KEYS = new Set<SuppliesArchiveHeader>([
  'NO',
  '폐기 처리일',
  '최종 재고',
]);

export type SuppliesArchiveExcelRow = Record<SuppliesArchiveHeader, string | number>;

/** 소모품 폐기자산 아카이브 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeSuppliesArchiveExcelBuffer(
  rows: SuppliesArchiveExcelRow[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '폐기자산_목록',
    headers: SUPPLIES_ARCHIVE_HEADERS,
    groups: SUPPLIES_ARCHIVE_GROUPS,
    rows,
    centerKeys: SUPPLIES_ARCHIVE_CENTER_KEYS,
  });
}

export async function downloadExcelJsBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
