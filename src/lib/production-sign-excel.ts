import { getKSTDateString } from '@/utils/dateUtils';

const CUSTOM_REQUEST_LABELS = ['메인문구(한글)', '메인문구(영문)', '기타'] as const;

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

function normalizeCustomRequests(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((req: unknown) => {
      if (typeof req === 'string') {
        return { label: '기타', value: req };
      }
      const row = req as { label?: string; value?: string };
      const rawLabel = String(row?.label || '기타');
      const label = (CUSTOM_REQUEST_LABELS as readonly string[]).includes(rawLabel)
        ? rawLabel
        : '기타';
      return { label, value: String(row?.value || '') };
    })
    .filter((r) => r.value.trim() !== '');
}

function plateSpecLabel(opts: Record<string, unknown>): string {
  const info = opts.plateMasterInfo as { label?: string; size?: string } | undefined;
  if (!info?.label) return '';
  return info.size ? `${info.label} (${info.size})` : str(info.label);
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

function maxCustomRequestCount(items: SignExcelSourceRow[]): number {
  return items.reduce((max, item) => {
    const count = normalizeCustomRequests(item.options?.customRequests).length;
    return Math.max(max, count);
  }, 0);
}

/** SIGN 상세 엑셀 행 — 발주·검수에 필요한 핵심 필드만. */
export function buildSignDetailExcelRow(
  item: SignExcelSourceRow,
  rowNo: number,
  maxCustomRequestCount: number
): Record<string, string | number> {
  const opts = (item.options || {}) as Record<string, unknown>;
  const customReqs = normalizeCustomRequests(opts.customRequests);

  const row: Record<string, string | number> = {
    NO: rowNo,
    신청일: getKSTDateString(item.createdAt),
    소속부서: str(item.deptName),
    신청자: str(item.userName),
    신청총수량: item.quantity,
    '1_품목및기본사양': plateSpecLabel(opts),
    '2_인증의종류': str(opts.certType),
    '3_인증상세또는등급': str(opts.certLevel),
    '4_프로젝트명건물명시설명기업명': projectOrCompanyName(opts),
    '5_인증번호': str(opts.certNumber),
    '6_현판유효기간': displaySignValidPeriod(opts.formattedValidPeriod),
    수령인성명: str(opts.receiverName),
    수령인연락처: str(opts.receiverPhone),
    배송지합본: buildShippingCombined(opts),
    현판신청회사: str(opts.companyName),
    기타설명1: str(opts.applicantName),
    기타설명2: str(opts.applicantPhone),
    신청현판번호_ISO전용: String(opts.certType || '').includes('ISO')
      ? str(opts.internalSystemSerial)
      : '',
  };

  for (let i = 0; i < maxCustomRequestCount; i++) {
    const req = customReqs[i];
    const n = i + 1;
    row[`7_추가제작변수${n}_구분`] = req?.label || '';
    row[`7_추가제작변수${n}_내용`] = req?.value || '';
  }

  return row;
}

/** SIGN 건별 상세 엑셀 행 목록 (체크 선택 또는 필터 목록 기준). */
export function buildSignDetailExcelRows(
  items: SignExcelSourceRow[]
): Record<string, string | number>[] {
  const signItems = items.filter((r) => r.category === 'SIGN');
  if (signItems.length === 0) return [];

  const customCols = maxCustomRequestCount(signItems);
  return signItems.map((item, idx) =>
    buildSignDetailExcelRow(item, signItems.length - idx, customCols)
  );
}
