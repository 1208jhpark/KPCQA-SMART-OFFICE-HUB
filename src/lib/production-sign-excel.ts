import { getKSTDateString } from '@/utils/dateUtils';

export type SignExcelSourceRow = {
  id: string;
  postNumber: string;
  category: string;
  title: string;
  quantity: number;
  status: string;
  userName: string;
  userEmail?: string;
  deptName: string;
  deptHead?: string;
  batchId?: string | null;
  createdAt: string;
  estimatedPrice?: number;
  options?: Record<string, unknown>;
};

/** SIGN·JEBON 엑셀 공통 소스 행 */
export type ProductionExcelSourceRow = SignExcelSourceRow;

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function byCreatedAtAsc<T extends { createdAt?: string | Date }>(a: T, b: T) {
  return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
}

/** 발주서 빈 칸은 공백 대신 바(-) */
function dash(v: unknown): string {
  const s = str(v).trim();
  return s ? s : '-';
}

/** 미입력·비활성 시 저장되는 포맷 템플릿(0000.00.00.~…)을 빈 값으로 취급 */
export function isEmptySignValidPeriod(value: unknown): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return !digits || /^0+$/.test(digits);
}

export function displaySignValidPeriod(value: unknown): string {
  return isEmptySignValidPeriod(value) ? '' : str(value);
}

function normalizeCustomRequests(raw: unknown): { value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((req: unknown) => {
      if (typeof req === 'string') return { value: req };
      const row = req as { value?: string };
      return { value: String(row?.value || '') };
    })
    .filter((r) => r.value.trim() !== '');
}

function plateLabel(opts: Record<string, unknown>): string {
  const info = opts.plateMasterInfo as { label?: string; size?: string } | undefined;
  return str(info?.label);
}

function plateSize(opts: Record<string, unknown>): string {
  const info = opts.plateMasterInfo as { label?: string; size?: string } | undefined;
  return str(info?.size);
}

function projectOrCompanyName(opts: Record<string, unknown>): string {
  if (String(opts.certType || '').includes('ISO')) return str(opts.isoCompanyName);
  return str(opts.projectName);
}

function buildShippingCombined(opts: Record<string, unknown>): string {
  if (opts.shippingAddress) return str(opts.shippingAddress);
  return [
    opts.shippingZipCode && `[${opts.shippingZipCode}]`,
    opts.shippingAddressRoad,
    opts.shippingAddressDetail,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatCustomRequests(raw: unknown): string {
  const list = normalizeCustomRequests(raw);
  if (list.length === 0) return '';
  return list.map((r, i) => `${i + 1}. ${r.value}`).join('\n');
}

/**
 * SIGN 엑셀 행
 * — 분류 / 관리용제목 / 외주업체 / 현재상태 제외
 * — 신청 식별(신청일·소속·신청자) + 요청 명세 컬럼만
 */
export function buildSignDetailExcelRow(
  item: SignExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    관리번호: str(item.postNumber),
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    신청수량: item.quantity,
    '인증의 종류': str(opts.certType),
    '인증 등급/종류': str(opts.certLevel),
    '현판 품목': plateLabel(opts),
    '현판 규격': plateSize(opts),
    '프로젝트명/건물명/경영시스템 조직명': projectOrCompanyName(opts),
    인증번호: str(opts.certNumber),
    '현판 유효기간': displaySignValidPeriod(opts.formattedValidPeriod),
    추가제작변수: formatCustomRequests(opts.customRequests),
    수령인성명: str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
    '현판 신청 회사': str(opts.companyName),
    '신청인 정보': str(opts.applicantName),
    기타: str(opts.applicantPhone),
  };
}

/** SIGN 건별 상세 엑셀 행 목록 (체크 선택 또는 필터 목록 기준). */
export function buildSignDetailExcelRows(
  items: SignExcelSourceRow[]
): Record<string, string | number>[] {
  const signItems = items.filter((r) => r.category === 'SIGN');
  if (signItems.length === 0) return [];

  return signItems.map((item, idx) =>
    buildSignDetailExcelRow(item, signItems.length - idx)
  );
}

/**
 * 외주 발주용 SIGN 엑셀 행
 * — 관리번호 / 현판 신청 회사 / 신청인 정보 / 기타 제외
 */
const ORDER_EXCEL_GRID = 'FFD9D9D9';
const ORDER_EXCEL_TEXT = 'FF333333';
const ORDER_EXCEL_TITLE_FILL = 'FFF1F3F5';
const ORDER_EXCEL_CONTENT_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: ORDER_EXCEL_TITLE_FILL,
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ORDER_EXCEL_SHIP_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: ORDER_EXCEL_TITLE_FILL,
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ORDER_EXCEL_APPLICANT_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: ORDER_EXCEL_TITLE_FILL,
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const SIGN_ORDER_HEADERS = [
  'NO',
  '현판 품목',
  '현판 규격',
  '신청수량',
  '인증의 종류',
  '인증 등급/범주',
  '프로젝트명',
  '인증번호',
  '현판 유효기간',
  '추가제작변수',
  '수령인 성명',
  '수령인 연락처',
  '배송지',
  '소속부서',
  '신청자',
] as const;

export type SignOrderHeader = (typeof SIGN_ORDER_HEADERS)[number];

const SIGN_ORDER_GROUPS: {
  label: string;
  keys: SignOrderHeader[];
  groupFill: string;
  headerFill: string;
  dataFill: string;
  dataAlt: string;
}[] = [
  {
    label: '발주내용',
    keys: [
      '현판 품목',
      '현판 규격',
      '신청수량',
      '인증의 종류',
      '인증 등급/범주',
      '프로젝트명',
      '인증번호',
      '현판 유효기간',
      '추가제작변수',
    ],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '배송정보',
    keys: ['수령인 성명', '수령인 연락처', '배송지'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
  {
    label: '신청인 정보',
    keys: ['소속부서', '신청자'],
    ...ORDER_EXCEL_APPLICANT_COLORS,
  },
];

const ORDER_EXCEL_NO_FILL = 'FF546E7A';
const SIGN_ORDER_CENTER_KEYS = new Set<SignOrderHeader>([
  'NO',
  '신청수량',
  '인증의 종류',
  '인증 등급/범주',
  '현판 품목',
  '현판 규격',
  '인증번호',
  '현판 유효기간',
  '추가제작변수',
  '수령인 성명',
  '수령인 연락처',
  '소속부서',
  '신청자',
]);

export type OrderExcelGroup<H extends string> = {
  label: string;
  keys: H[];
  groupFill: string;
  headerFill: string;
  dataFill: string;
  dataAlt: string;
};

export function buildSignOrderExcelRow(
  item: SignExcelSourceRow,
  rowNo: number
): Record<SignOrderHeader, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    '현판 품목': dash(plateLabel(opts)),
    '현판 규격': dash(plateSize(opts)),
    신청수량: item.quantity ?? '-',
    '인증의 종류': dash(opts.certType),
    '인증 등급/범주': dash(opts.certLevel),
    프로젝트명: dash(projectOrCompanyName(opts)),
    인증번호: dash(opts.certNumber),
    '현판 유효기간': dash(displaySignValidPeriod(opts.formattedValidPeriod)),
    추가제작변수: dash(formatCustomRequests(opts.customRequests)),
    '수령인 성명': dash(opts.receiverName),
    '수령인 연락처': dash(opts.receiverPhone),
    배송지: dash(buildShippingCombined(opts)),
    소속부서: dash(item.deptName),
    신청자: dash(item.userName),
  };
}

/** 명세서 검수·묶음 발주용 SIGN 엑셀 */
export function buildSignOrderExcelRows(
  items: SignExcelSourceRow[]
): Record<SignOrderHeader, string | number>[] {
  const signItems = items.filter((r) => r.category === 'SIGN').sort(byCreatedAtAsc);
  if (signItems.length === 0) return [];

  return signItems.map((item, idx) => buildSignOrderExcelRow(item, idx + 1));
}

function excelDisplayWidth(v: unknown): number {
  const s = v == null ? '' : String(v);
  let max = 0;
  for (const line of s.split(/\r?\n/)) {
    let w = 0;
    for (const ch of line) w += ch.charCodeAt(0) > 127 ? 2 : 1;
    if (w > max) max = w;
  }
  return max;
}

function majorityDeptName(items: SignExcelSourceRow[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = String(item.deptName || '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  counts.forEach((n, name) => {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  });
  return best;
}

/** Excel 시트명 31자 · [] 불가 → 현판발주서(부서) */
function orderExcelSheetName(kindLabel: string, deptName: string): string {
  const dept = String(deptName || '')
    .replace(/[:\\/?*[\]［］]/g, '')
    .trim() || '부서';
  const prefix = `${kindLabel}(`;
  const suffix = ')';
  const maxDept = Math.max(1, 31 - prefix.length - suffix.length);
  return `${prefix}${dept.slice(0, maxDept)}${suffix}`;
}

export async function createGroupedOrderWorkbook<H extends string>(opts: {
  sheetName: string;
  headers: readonly H[];
  groups: OrderExcelGroup<H>[];
  rows: Array<Record<H, string | number>>;
  centerKeys: ReadonlySet<H>;
  wideKeys?: ReadonlySet<string>;
  emptyCell?: string | number;
  extraEmptyRows?: number;
  workbook?: import('exceljs').Workbook;
}): Promise<{
  workbook: import('exceljs').Workbook;
  sheet: import('exceljs').Worksheet;
}> {
  const { sheetName, headers, groups, rows, centerKeys } = opts;
  const blank = opts.emptyCell ?? '-';
  const ExcelJS = (await import('exceljs')).default;
  const workbook = opts.workbook || new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  const gridLine = { style: 'thin' as const, color: { argb: ORDER_EXCEL_GRID } };
  const gridBorder = { top: gridLine, left: gridLine, bottom: gridLine, right: gridLine };
  const groupFont = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
    size: 11,
    name: '맑은 고딕',
  };
  const titleFont = {
    bold: true,
    color: { argb: ORDER_EXCEL_TEXT },
    size: 10,
    name: '맑은 고딕',
  };

  const colIndex = (key: H) => headers.indexOf(key) + 1;
  const groupOf = (key: H | undefined) =>
    key ? groups.find((g) => (g.keys as readonly string[]).includes(key)) : undefined;

  const groupRow = sheet.getRow(1);
  groupRow.height = 26;
  const titleRow = sheet.getRow(2);
  titleRow.height = 24;

  const paintHeader = (
    cell: import('exceljs').Cell,
    fill: string,
    font: { bold: boolean; color: { argb: string }; size: number; name: string }
  ) => {
    cell.font = font;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = gridBorder;
  };

  const noCell = groupRow.getCell(1);
  noCell.value = 'NO';
  paintHeader(noCell, ORDER_EXCEL_NO_FILL, groupFont);
  sheet.mergeCells(1, 1, 2, 1);

  for (const group of groups) {
    const first = group.keys[0];
    const last = group.keys[group.keys.length - 1];
    if (!first || !last) continue;
    const start = colIndex(first);
    const end = colIndex(last);
    const cell = groupRow.getCell(start);
    cell.value = group.label;
    paintHeader(cell, group.groupFill, groupFont);
    if (end > start) sheet.mergeCells(1, start, 1, end);
  }

  headers.forEach((key, idx) => {
    if (key === 'NO') return;
    const cell = titleRow.getCell(idx + 1);
    const group = groupOf(key);
    cell.value = key;
    paintHeader(cell, group?.headerFill || ORDER_EXCEL_TITLE_FILL, titleFont);
  });

  const cellValue = (row: Record<H, string | number>, key: H) => {
    const v = row[key];
    if (v === undefined || v === null || v === '') return blank;
    return v;
  };

  rows.forEach((row) => {
    const excelRow = sheet.addRow(headers.map((key) => cellValue(row, key)));
    const lineCount = headers.reduce((max, key) => {
      const n = String(row[key] ?? '').split('\n').length;
      return Math.max(max, n);
    }, 1);
    excelRow.height = Math.max(22, lineCount * 16);
  });

  const extraEmpty = Math.max(0, opts.extraEmptyRows ?? 0);
  for (let i = 0; i < extraEmpty; i += 1) {
    const excelRow = sheet.addRow(headers.map(() => blank));
    excelRow.height = 22;
  }

  const colCount = headers.length;
  for (let r = 1; r <= 2; r += 1) {
    for (let c = 1; c <= colCount; c += 1) {
      sheet.getRow(r).getCell(c).border = gridBorder;
    }
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    for (let c = 1; c <= colCount; c += 1) {
      const cell = row.getCell(c);
      const key = headers[c - 1];
      cell.font = { size: 10, name: '맑은 고딕', color: { argb: ORDER_EXCEL_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: key && centerKeys.has(key) ? 'center' : 'left',
        wrapText: true,
      };
      cell.border = gridBorder;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' },
      };
    }
  });

  headers.forEach((key, idx) => {
    let max = excelDisplayWidth(key);
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      max = Math.max(max, excelDisplayWidth(sheet.getRow(r).getCell(idx + 1).value));
    }
    sheet.getColumn(idx + 1).width = Math.min(255, Math.max(4, max + 2));
  });

  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3' }];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: false,
  };

  return { workbook, sheet };
}

export async function writeGroupedOrderExcelBuffer<H extends string>(opts: {
  sheetName: string;
  headers: readonly H[];
  groups: OrderExcelGroup<H>[];
  rows: Array<Record<H, string | number>>;
  centerKeys: ReadonlySet<H>;
  wideKeys?: ReadonlySet<string>;
  emptyCell?: string | number;
  extraEmptyRows?: number;
}): Promise<ArrayBuffer> {
  const { workbook } = await createGroupedOrderWorkbook(opts);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/** 여러 시트를 명함/발주서와 같은 그룹행·3톤으로 한 파일에 기록 */
export async function writeMultiGroupedOrderExcelBuffer(
  sheets: Array<{
    sheetName: string;
    headers: readonly string[];
    groups: OrderExcelGroup<string>[];
    rows: Array<Record<string, string | number>>;
    centerKeys: ReadonlySet<string>;
    emptyCell?: string | number;
    extraEmptyRows?: number;
  }>
): Promise<ArrayBuffer> {
  if (!sheets.length) {
    throw new Error('시트가 없습니다.');
  }
  let workbook: import('exceljs').Workbook | undefined;
  for (const sheet of sheets) {
    const created = await createGroupedOrderWorkbook({
      ...sheet,
      workbook,
    });
    workbook = created.workbook;
  }
  const buffer = await workbook!.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/** 현판 발주서 — 그룹행 + 3톤 컬러 + 간격 (ExcelJS) */
export async function writeSignOrderExcelBuffer(
  items: SignExcelSourceRow[]
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: orderExcelSheetName(
      '현판발주서',
      majorityDeptName(items.filter((r) => r.category === 'SIGN'))
    ),
    headers: SIGN_ORDER_HEADERS,
    groups: SIGN_ORDER_GROUPS,
    rows: buildSignOrderExcelRows(items),
    centerKeys: SIGN_ORDER_CENTER_KEYS,
  });
}

function resolveJebonSizeKindSpec(opts: Record<string, unknown>) {
  const typeCode = str(opts.jebonSizeType).trim();
  const sizeSpec = str(opts.jebonSize).trim();

  if (!typeCode && !sizeSpec) return { kind: '', spec: '' };

  if (!typeCode) {
    if (/×|mm|절|\d/.test(sizeSpec) && sizeSpec.length > 3) {
      return { kind: '', spec: sizeSpec };
    }
    return { kind: sizeSpec, spec: '' };
  }

  const isCustom = typeCode === '비규격' || typeCode === 'CUSTOM';
  if (isCustom) return { kind: typeCode, spec: sizeSpec };

  const spec = sizeSpec && sizeSpec !== typeCode ? sizeSpec : '';
  return { kind: typeCode, spec };
}

function jebonProjectTitle(opts: Record<string, unknown>): string {
  return str(opts.jebonBuildingName).trim() || str(opts.coverName).trim() || '';
}

function displayJebonPageCount(
  fromAttachment: unknown,
  count: unknown,
  variant: 'detail' | 'order' = 'detail'
): string {
  if (fromAttachment === true || fromAttachment === 'true') {
    return variant === 'order' ? '첨부파일 참고' : '면수는 첨부파일에 따름';
  }
  const n = str(count).trim();
  if (!n) return '';
  return n;
}

/**
 * JEBON(제본) 상세 엑셀 행
 */
export function buildJebonDetailExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;
  const { kind: sizeKind, spec: sizeSpec } = resolveJebonSizeKindSpec(opts);

  return {
    NO: rowNo,
    관리번호: str(item.postNumber),
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    신청수량: item.quantity,
    '제본 종류': str(opts.certType),
    '인증 단계': str(opts.certPhase),
    판형종류: sizeKind,
    판형규격: sizeSpec,
    표지스팩: str(opts.coverColor),
    표지면수: displayJebonPageCount(opts.coverPageFromAttachment, opts.coverPageCount),
    본문스팩: str(opts.innerColor),
    본문면수: displayJebonPageCount(opts.innerPageFromAttachment, opts.innerPageCount),
    '프로젝트명/건물명/표지제목': jebonProjectTitle(opts),
    '표지 일자': str(opts.formattedCompDate),
    추가제작변수: formatCustomRequests(opts.customRequests),
    '수령인 성명': str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
  };
}

/** JEBON 건별 상세 엑셀 행 목록 */
export function buildJebonDetailExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const jebonItems = items.filter((r) => r.category === 'JEBON');
  if (jebonItems.length === 0) return [];

  return jebonItems.map((item, idx) =>
    buildJebonDetailExcelRow(item, jebonItems.length - idx)
  );
}

export const JEBON_ORDER_HEADERS = [
  'NO',
  '신청부수',
  '제본 종류',
  '인증 단계',
  '프로젝트명',
  '표지 일자',
  '판형종류',
  '판형규격',
  '표지스팩',
  '표지면수',
  '본문스팩',
  '본문면수',
  '추가제작변수',
  '수령인 성명',
  '수령인 연락처',
  '배송지',
  '소속부서',
  '신청자',
] as const;

export type JebonOrderHeader = (typeof JEBON_ORDER_HEADERS)[number];

const JEBON_ORDER_GROUPS: OrderExcelGroup<JebonOrderHeader>[] = [
  {
    label: '발주내용',
    keys: [
      '신청부수',
      '제본 종류',
      '인증 단계',
      '프로젝트명',
      '표지 일자',
      '판형종류',
      '판형규격',
      '표지스팩',
      '표지면수',
      '본문스팩',
      '본문면수',
      '추가제작변수',
    ],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '배송정보',
    keys: ['수령인 성명', '수령인 연락처', '배송지'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
  {
    label: '신청인 정보',
    keys: ['소속부서', '신청자'],
    ...ORDER_EXCEL_APPLICANT_COLORS,
  },
];

const JEBON_ORDER_CENTER_KEYS = new Set<JebonOrderHeader>(
  JEBON_ORDER_HEADERS.filter((h) => h !== '프로젝트명' && h !== '배송지')
);

/**
 * 외주 발주용 JEBON 엑셀 행 — 관리번호 제외 (order 상세와 동일 명세)
 */
export function buildJebonOrderExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<JebonOrderHeader, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;
  const { kind: sizeKind, spec: sizeSpec } = resolveJebonSizeKindSpec(opts);

  return {
    NO: rowNo,
    '신청부수': item.quantity ?? '-',
    '제본 종류': dash(opts.certType),
    '인증 단계': dash(opts.certPhase),
    프로젝트명: dash(jebonProjectTitle(opts)),
    '표지 일자': dash(opts.formattedCompDate),
    판형종류: dash(sizeKind),
    판형규격: dash(sizeSpec),
    표지스팩: dash(opts.coverColor),
    표지면수: dash(
      displayJebonPageCount(opts.coverPageFromAttachment, opts.coverPageCount, 'order')
    ),
    본문스팩: dash(opts.innerColor),
    본문면수: dash(
      displayJebonPageCount(opts.innerPageFromAttachment, opts.innerPageCount, 'order')
    ),
    추가제작변수: dash(formatCustomRequests(opts.customRequests)),
    '수령인 성명': dash(opts.receiverName),
    '수령인 연락처': dash(opts.receiverPhone),
    배송지: dash(buildShippingCombined(opts)),
    소속부서: dash(item.deptName),
    신청자: dash(item.userName),
  };
}

/** 명세서 검수·묶음 발주용 JEBON 엑셀 */
export function buildJebonOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<JebonOrderHeader, string | number>[] {
  const jebonItems = items.filter((r) => r.category === 'JEBON').sort(byCreatedAtAsc);
  if (jebonItems.length === 0) return [];

  return jebonItems.map((item, idx) => buildJebonOrderExcelRow(item, idx + 1));
}

export async function writeJebonOrderExcelBuffer(
  items: ProductionExcelSourceRow[]
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: orderExcelSheetName(
      '제본발주서',
      majorityDeptName(items.filter((r) => r.category === 'JEBON'))
    ),
    headers: JEBON_ORDER_HEADERS,
    groups: JEBON_ORDER_GROUPS,
    rows: buildJebonOrderExcelRows(items),
    centerKeys: JEBON_ORDER_CENTER_KEYS,
    wideKeys: new Set([
      '배송지',
      '추가제작변수',
      '프로젝트명',
    ]),
  });
}

/**
 * 기타 제작물 — 신청 화면 「선택 물품 정보/규격」과 동일
 * (일반: 품목명 + 규격 / 직접입력: printCustomName)
 */
export function formatPrintItemInfoSpec(opts: Record<string, unknown>): string {
  const name = printSelectedItemName(opts);
  const size = printSelectedItemSize(opts);
  if (!name) return size;
  if (!size) return name;
  return `${name} ${size}`;
}

/** 선택 물품명 (직접입력 시 printCustomName) */
export function printSelectedItemName(opts: Record<string, unknown>): string {
  const info = opts.printItemMasterInfo as
    | { name?: string; isCustom?: boolean }
    | undefined;
  if (info?.isCustom) {
    return str(opts.printCustomName).trim() || str(opts.printItemType);
  }
  return str(info?.name || opts.printItemType || opts.printCustomName).trim();
}

/** 선택 물품 규격 (직접입력 시 빈 값) */
export function printSelectedItemSize(opts: Record<string, unknown>): string {
  const info = opts.printItemMasterInfo as
    | { size?: string; isCustom?: boolean }
    | undefined;
  if (info?.isCustom) return '';
  return str(info?.size).trim();
}

/**
 * PRINT(기타 제작물) 상세 엑셀 행 — /order 제작 신청서 다운로드
 */
export function buildPrintDetailExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    관리번호: str(item.postNumber),
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    수량: item.quantity,
    '선택 물품 정보/규격': formatPrintItemInfoSpec(opts),
    인쇄제작문구1: str(opts.printItemDetails),
    '인쇄 제작 문구2': str(opts.printDeliveryDetails),
    '추가 제작 변수': formatCustomRequests(opts.customRequests),
    '수령인 성명': str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
  };
}

/** PRINT 건별 상세 엑셀 행 목록 */
export function buildPrintDetailExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const printItems = items.filter((r) => r.category === 'PRINT');
  if (printItems.length === 0) return [];

  return printItems.map((item, idx) =>
    buildPrintDetailExcelRow(item, printItems.length - idx)
  );
}

/** 기타제작 수량 단위: 개(EA) → 개 */
function shortPrintUnitLabel(opts: Record<string, unknown>): string {
  const info = opts.printItemMasterInfo as { unitLabel?: string } | undefined;
  const full = str(info?.unitLabel).trim();
  if (!full) return 'EA';
  const short = full.replace(/\([^)]*\)/g, '').trim();
  return short || full;
}

function formatPrintOrderQuantity(item: ProductionExcelSourceRow): string {
  if (item.quantity == null) return '-';
  const opts = (item.options || {}) as Record<string, unknown>;
  return `${item.quantity}${shortPrintUnitLabel(opts)}`;
}

export const PRINT_ORDER_HEADERS = [
  'NO',
  '선택물품 정보',
  '규격',
  '신청수량',
  '인쇄 제작 문구1',
  '인쇄 제작 문구2',
  '추가제작변수',
  '수령인 성명',
  '수령인 연락처',
  '배송지',
  '소속부서',
  '신청자',
] as const;

export type PrintOrderHeader = (typeof PRINT_ORDER_HEADERS)[number];

const PRINT_ORDER_GROUPS: OrderExcelGroup<PrintOrderHeader>[] = [
  {
    label: '발주내용',
    keys: [
      '선택물품 정보',
      '규격',
      '신청수량',
      '인쇄 제작 문구1',
      '인쇄 제작 문구2',
      '추가제작변수',
    ],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '배송정보',
    keys: ['수령인 성명', '수령인 연락처', '배송지'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
  {
    label: '신청인 정보',
    keys: ['소속부서', '신청자'],
    ...ORDER_EXCEL_APPLICANT_COLORS,
  },
];

const PRINT_ORDER_CENTER_KEYS = new Set<PrintOrderHeader>(
  PRINT_ORDER_HEADERS.filter(
    (h) => h !== '배송지' && h !== '인쇄 제작 문구1' && h !== '인쇄 제작 문구2'
  )
);

/**
 * 외주 발주용 PRINT 엑셀 행 — 관리번호·신청일 제외, 선택물품/규격 분리
 */
export function buildPrintOrderExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<PrintOrderHeader, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    '선택물품 정보': dash(printSelectedItemName(opts)),
    규격: dash(printSelectedItemSize(opts)),
    신청수량: formatPrintOrderQuantity(item),
    '인쇄 제작 문구1': dash(opts.printItemDetails),
    '인쇄 제작 문구2': dash(opts.printDeliveryDetails),
    추가제작변수: dash(formatCustomRequests(opts.customRequests)),
    '수령인 성명': dash(opts.receiverName),
    '수령인 연락처': dash(opts.receiverPhone),
    배송지: dash(buildShippingCombined(opts)),
    소속부서: dash(item.deptName),
    신청자: dash(item.userName),
  };
}

/** 명세서 검수·묶음 발주용 PRINT 엑셀 */
export function buildPrintOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<PrintOrderHeader, string | number>[] {
  const printItems = items.filter((r) => r.category === 'PRINT').sort(byCreatedAtAsc);
  if (printItems.length === 0) return [];

  return printItems.map((item, idx) => buildPrintOrderExcelRow(item, idx + 1));
}

/** 기타제작물 발주서 — 그룹행 + 3톤 컬러 (ExcelJS, 현판·제본과 동일) */
export async function writePrintOrderExcelBuffer(
  items: ProductionExcelSourceRow[]
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: orderExcelSheetName(
      '기타제작발주서',
      majorityDeptName(items.filter((r) => r.category === 'PRINT'))
    ),
    headers: PRINT_ORDER_HEADERS,
    groups: PRINT_ORDER_GROUPS,
    rows: buildPrintOrderExcelRows(items),
    centerKeys: PRINT_ORDER_CENTER_KEYS,
    wideKeys: new Set(['배송지', '추가제작변수', '인쇄 제작 문구1', '인쇄 제작 문구2', '선택물품 정보']),
  });
}

/**
 * OFFICE_SUPPLIES(사무문구류) 상세 엑셀 행 — apply/history 다운로드
 */
export function buildOfficeSuppliesDetailExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  return {
    No: rowNo,
    관리번호: str(item.postNumber),
    신청일: getKSTDateString(item.createdAt),
    '소속 부서': str(item.deptName),
    신청자: str(item.userName),
    '관리용 제목': str(item.title),
    건: item.quantity,
  };
}

/** 사무문구류 건별 상세 엑셀 행 목록 */
export function buildOfficeSuppliesDetailExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const officeItems = items.filter((r) => r.category === 'OFFICE_SUPPLIES');
  if (officeItems.length === 0) return [];

  return officeItems.map((item, idx) =>
    buildOfficeSuppliesDetailExcelRow(item, officeItems.length - idx)
  );
}

/**
 * 외주 발주용 OFFICE_SUPPLIES 엑셀 행 — 신청내역 고정(견적서 첨부)
 */
export function buildOfficeSuppliesOrderExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    신청내역: '견적서 PDF 첨부(필수)',
    '수령인 성명': str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
  };
}

/** 명세서 검수·묶음 발주용 OFFICE_SUPPLIES 엑셀 */
export function buildOfficeSuppliesOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const officeItems = items
    .filter((r) => r.category === 'OFFICE_SUPPLIES')
    .sort(byCreatedAtAsc);
  if (officeItems.length === 0) return [];

  return officeItems.map((item, idx) =>
    buildOfficeSuppliesOrderExcelRow(item, idx + 1)
  );
}

export const DEPT_HISTORY_LIST_HEADERS = [
  'NO',
  '관리번호',
  '신청일',
  '부서',
  '신청자',
  '분류',
  '관리용 제목',
  '신청내역',
  '수량',
  '외주업체',
  '처리날짜',
  '공정상태',
] as const;

export type DeptHistoryListHeader = (typeof DEPT_HISTORY_LIST_HEADERS)[number];

const DEPT_HISTORY_LIST_GROUPS: OrderExcelGroup<DeptHistoryListHeader>[] = [
  {
    label: '신청정보',
    keys: [
      '관리번호',
      '신청일',
      '부서',
      '신청자',
      '분류',
      '관리용 제목',
      '신청내역',
      '수량',
    ],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '진행정보',
    keys: ['외주업체', '처리날짜', '공정상태'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
];

const DEPT_HISTORY_LIST_CENTER_KEYS = new Set<DeptHistoryListHeader>(
  DEPT_HISTORY_LIST_HEADERS.filter((h) => h !== '관리용 제목')
);

/** 부서 이력 화면 목록 — 발주서와 같은 그룹행·3톤 스타일 */
export async function writeDeptHistoryListExcelBuffer(
  rows: Array<Record<DeptHistoryListHeader, string | number>>
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: '목록',
    headers: DEPT_HISTORY_LIST_HEADERS,
    groups: DEPT_HISTORY_LIST_GROUPS,
    rows,
    centerKeys: DEPT_HISTORY_LIST_CENTER_KEYS,
  });
}

export const CLIENT_ADDRESS_LIST_HEADERS = [
  'NO',
  '고객사명',
  '업무범주',
  '관리비고',
  '우편번호',
  '기본(도로명)주소',
  '상세주소',
  '소재지',
  '등록일',
  '수정일',
] as const;

export type ClientAddressListHeader = (typeof CLIENT_ADDRESS_LIST_HEADERS)[number];

const CLIENT_ADDRESS_LIST_GROUPS: OrderExcelGroup<ClientAddressListHeader>[] = [
  {
    label: '고객사정보',
    keys: ['고객사명', '업무범주', '관리비고'],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '주소정보',
    keys: ['우편번호', '기본(도로명)주소', '상세주소', '소재지'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
  {
    label: '관리정보',
    keys: ['등록일', '수정일'],
    ...ORDER_EXCEL_APPLICANT_COLORS,
  },
];

const CLIENT_ADDRESS_LIST_CENTER_KEYS = new Set<ClientAddressListHeader>([
  'NO',
  '업무범주',
  '우편번호',
  '등록일',
  '수정일',
]);

/** 고객사 주소 대장 목록 — 발주서·이력 목록과 같은 그룹행·3톤 스타일 */
export async function writeClientAddressListExcelBuffer(
  rows: Array<Record<ClientAddressListHeader, string | number>>
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: '고객사_주소',
    headers: CLIENT_ADDRESS_LIST_HEADERS,
    groups: CLIENT_ADDRESS_LIST_GROUPS,
    rows,
    centerKeys: CLIENT_ADDRESS_LIST_CENTER_KEYS,
  });
}

/** 업로드 양식 — 목록과 동일하되 소재지(H)·관리정보(등록일·수정일) 제외 */
export const CLIENT_ADDRESS_UPLOAD_HEADERS = [
  'NO',
  '고객사명',
  '업무범주',
  '관리비고',
  '우편번호',
  '기본(도로명)주소',
  '상세주소',
] as const;

export type ClientAddressUploadHeader = (typeof CLIENT_ADDRESS_UPLOAD_HEADERS)[number];

const CLIENT_ADDRESS_UPLOAD_GROUPS: OrderExcelGroup<ClientAddressUploadHeader>[] = [
  {
    label: '고객사정보',
    keys: ['고객사명', '업무범주', '관리비고'],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '주소정보',
    keys: ['우편번호', '기본(도로명)주소', '상세주소'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
];

const CLIENT_ADDRESS_UPLOAD_CENTER_KEYS = new Set<ClientAddressUploadHeader>([
  'NO',
  '업무범주',
  '우편번호',
]);

const CLIENT_ADDRESS_UPLOAD_DATA_ROWS = 500;

export async function writeClientAddressUploadTemplateBuffer(
  categories: string[],
  sampleCategory: string
): Promise<ArrayBuffer> {
  const sampleRow: Record<ClientAddressUploadHeader, string | number> = {
    NO: 1,
    고객사명: '예시고객사',
    업무범주: sampleCategory || '',
    관리비고: '',
    우편번호: '12345',
    '기본(도로명)주소': '서울특별시 예시구 예시로 1',
    상세주소: '101호',
  };

  const { workbook, sheet } = await createGroupedOrderWorkbook({
    sheetName: '고객사_주소',
    headers: CLIENT_ADDRESS_UPLOAD_HEADERS,
    groups: CLIENT_ADDRESS_UPLOAD_GROUPS,
    rows: [sampleRow],
    centerKeys: CLIENT_ADDRESS_UPLOAD_CENTER_KEYS,
    emptyCell: '',
    extraEmptyRows: CLIENT_ADDRESS_UPLOAD_DATA_ROWS - 1,
  });
  workbook.creator = 'KPCQA WISE';

  const listSheet = workbook.addWorksheet('업무범주목록');
  const cats = categories.map((c) => String(c).trim()).filter(Boolean);
  cats.forEach((cat, i) => {
    listSheet.getCell(i + 1, 1).value = cat;
  });
  listSheet.getColumn(1).width = 28;
  listSheet.state = 'hidden';

  const categoryCol = CLIENT_ADDRESS_UPLOAD_HEADERS.indexOf('업무범주') + 1;
  const listEnd = Math.max(cats.length, 1);
  const dvFormula = `'업무범주목록'!$A$1:$A$${listEnd}`;
  const dataStart = 3;
  const dataEnd = 2 + CLIENT_ADDRESS_UPLOAD_DATA_ROWS;
  for (let r = dataStart; r <= dataEnd; r += 1) {
    sheet.getCell(r, categoryCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [dvFormula],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: '업무범주',
      error: `다음 중 선택해 주세요.\n${cats.join('\n')}`,
      showInputMessage: true,
      promptTitle: '업무범주',
      prompt: `선택 가능: ${cats.join(' / ')}`,
    };
  }

  const guide = workbook.addWorksheet('작성안내');
  guide.getCell(1, 1).value = '고객사 주소 엑셀 업로드 안내';
  guide.getCell(1, 1).font = { bold: true, size: 13 };
  guide.getCell(3, 1).value = '1) 「고객사_주소」시트에 데이터를 입력한 뒤 업로드하세요.';
  guide.getCell(4, 1).value = '2) 업무범주 칸은 드롭다운에서 선택하세요.';
  guide.getCell(5, 1).value =
    '3) 3행 예시는 업로드되지 않습니다. 4행부터 실제 데이터를 입력하세요.';
  guide.getCell(6, 1).value =
    '4) 이미 등록된 고객사명은 업로드되지 않습니다. 상태는 운영중으로 등록됩니다.';
  guide.getCell(7, 1).value =
    '5) 목록 엑셀의 소재지·등록일·수정일은 업로드에 사용하지 않습니다.';
  guide.getColumn(1).width = 78;

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export const ARCHIVE_SELECTED_LIST_HEADERS = [
  'NO',
  '발주번호',
  '분류',
  '관리번호',
  '소속부서',
  '신청자',
  '관리용제목',
  '외주업체',
  '발주확정일',
  '발주담당자',
  '수량',
  '명세확인금액',
] as const;

export type ArchiveSelectedListHeader = (typeof ARCHIVE_SELECTED_LIST_HEADERS)[number];

const ARCHIVE_SELECTED_LIST_GROUPS: OrderExcelGroup<ArchiveSelectedListHeader>[] = [
  {
    label: '신청정보',
    keys: ['발주번호', '분류', '관리번호', '소속부서', '신청자', '관리용제목'],
    ...ORDER_EXCEL_CONTENT_COLORS,
  },
  {
    label: '발주정보',
    keys: ['외주업체', '발주확정일', '발주담당자'],
    ...ORDER_EXCEL_SHIP_COLORS,
  },
  {
    label: '명세정보',
    keys: ['수량', '명세확인금액'],
    ...ORDER_EXCEL_APPLICANT_COLORS,
  },
];

const ARCHIVE_SELECTED_LIST_CENTER_KEYS = new Set<ArchiveSelectedListHeader>(
  ARCHIVE_SELECTED_LIST_HEADERS.filter((h) => h !== '관리용제목')
);

/** 대조완료 보관함 선택 목록 — 발주서·이력과 같은 그룹행·3톤 스타일 */
export async function writeArchiveSelectedExcelBuffer(
  rows: Array<Record<ArchiveSelectedListHeader, string | number>>
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: '선택묶음',
    headers: ARCHIVE_SELECTED_LIST_HEADERS,
    groups: ARCHIVE_SELECTED_LIST_GROUPS,
    rows,
    centerKeys: ARCHIVE_SELECTED_LIST_CENTER_KEYS,
  });
}
