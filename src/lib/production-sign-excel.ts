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
export function buildSignOrderExcelRow(
  item: SignExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
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
  };
}

/** 명세서 검수·묶음 발주용 SIGN 엑셀 */
export function buildSignOrderExcelRows(
  items: SignExcelSourceRow[]
): Record<string, string | number>[] {
  const signItems = items.filter((r) => r.category === 'SIGN');
  if (signItems.length === 0) return [];

  return signItems.map((item, idx) =>
    buildSignOrderExcelRow(item, signItems.length - idx)
  );
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
  return (
    str(opts.jebonFormTitle).trim() ||
    str(opts.jebonBuildingName).trim() ||
    str(opts.coverName).trim() ||
    ''
  );
}

function displayJebonPageCount(fromAttachment: unknown, count: unknown): string {
  if (fromAttachment === true) return '면수는 첨부파일에 따름';
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

/**
 * 외주 발주용 JEBON 엑셀 행 — 관리번호 제외 (order 상세와 동일 명세)
 */
export function buildJebonOrderExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;
  const { kind: sizeKind, spec: sizeSpec } = resolveJebonSizeKindSpec(opts);

  return {
    NO: rowNo,
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

/** 명세서 검수·묶음 발주용 JEBON 엑셀 */
export function buildJebonOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const jebonItems = items.filter((r) => r.category === 'JEBON');
  if (jebonItems.length === 0) return [];

  return jebonItems.map((item, idx) =>
    buildJebonOrderExcelRow(item, jebonItems.length - idx)
  );
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

/**
 * 외주 발주용 PRINT 엑셀 행 — 관리번호 제외, 선택물품/규격 분리
 */
export function buildPrintOrderExcelRow(
  item: ProductionExcelSourceRow,
  rowNo: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;

  return {
    NO: rowNo,
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    신청수량: item.quantity,
    '선택물품 정보': printSelectedItemName(opts),
    규격: printSelectedItemSize(opts),
    '인쇄 제작 문구1': str(opts.printItemDetails),
    '인쇄 제작 문구2': str(opts.printDeliveryDetails),
    '추가 제작 변수': formatCustomRequests(opts.customRequests),
    '수령인 성명': str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
  };
}

/** 명세서 검수·묶음 발주용 PRINT 엑셀 */
export function buildPrintOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const printItems = items.filter((r) => r.category === 'PRINT');
  if (printItems.length === 0) return [];

  return printItems.map((item, idx) =>
    buildPrintOrderExcelRow(item, printItems.length - idx)
  );
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
    신청내역: '견적서 첨부',
    '수령인 성명': str(opts.receiverName),
    '수령인 연락처': str(opts.receiverPhone),
    배송지: buildShippingCombined(opts),
  };
}

/** 명세서 검수·묶음 발주용 OFFICE_SUPPLIES 엑셀 */
export function buildOfficeSuppliesOrderExcelRows(
  items: ProductionExcelSourceRow[]
): Record<string, string | number>[] {
  const officeItems = items.filter((r) => r.category === 'OFFICE_SUPPLIES');
  if (officeItems.length === 0) return [];

  return officeItems.map((item, idx) =>
    buildOfficeSuppliesOrderExcelRow(item, officeItems.length - idx)
  );
}
