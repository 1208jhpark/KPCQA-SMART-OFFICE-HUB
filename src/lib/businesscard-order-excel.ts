import { writeGroupedOrderExcelBuffer } from '@/lib/production-sign-excel';
import { stripBusinessCardEnPlus } from '@/lib/businesscard-phone';

/** 제작물 dept-master/inspection 발주서와 동일한 3톤 그룹 헤더 */
const CONTENT_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const CONTACT_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const EN_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const BUSINESS_CARD_ORDER_HEADERS = [
  'NO',
  '관리번호',
  '수량(통)',
  '성명',
  '신청일자',
  '본부',
  '소속',
  '직책/직급',
  '추가사항',
  '우편번호',
  '주소',
  '휴대전화',
  '전화번호',
  '팩스',
  '이메일',
  '영문이름',
  '영문본부',
  '영문소속',
  '영문직책',
  '영문추가',
  '영문주소',
  '영문 휴대전화',
  '영문전화',
  '영문팩스',
  '이메일(영문)',
] as const;

export type BusinessCardOrderHeader = (typeof BUSINESS_CARD_ORDER_HEADERS)[number];

const BUSINESS_CARD_ORDER_GROUPS = [
  {
    label: '발주내용',
    keys: [
      '관리번호',
      '수량(통)',
      '성명',
      '신청일자',
      '본부',
      '소속',
      '직책/직급',
      '추가사항',
    ] as BusinessCardOrderHeader[],
    ...CONTENT_COLORS,
  },
  {
    label: '연락처·주소',
    keys: [
      '우편번호',
      '주소',
      '휴대전화',
      '전화번호',
      '팩스',
      '이메일',
    ] as BusinessCardOrderHeader[],
    ...CONTACT_COLORS,
  },
  {
    label: '영문정보',
    keys: [
      '영문이름',
      '영문본부',
      '영문소속',
      '영문직책',
      '영문추가',
      '영문주소',
      '영문 휴대전화',
      '영문전화',
      '영문팩스',
      '이메일(영문)',
    ] as BusinessCardOrderHeader[],
    ...EN_COLORS,
  },
];

const BUSINESS_CARD_ORDER_CENTER_KEYS = new Set<BusinessCardOrderHeader>([
  'NO',
  '관리번호',
  '수량(통)',
  '신청일자',
  '우편번호',
]);

export type BusinessCardOrderExcelSource = {
  postNumber?: string | null;
  quantity?: number | null;
  userName?: string | null;
  applyDate?: string | null;
  deptHead?: string | null;
  deptName?: string | null;
  title?: string | null;
  additionalKo?: string | null;
  zipCode?: string | null;
  addressKo?: string | null;
  mobile?: string | null;
  phone?: string | null;
  fax?: string | null;
  email?: string | null;
  userNameEn?: string | null;
  deptHeadEn?: string | null;
  deptNameEn?: string | null;
  titleEn?: string | null;
  additionalEn?: string | null;
  addressEn?: string | null;
  mobileEn?: string | null;
  phoneEn?: string | null;
  faxEn?: string | null;
  emailEn?: string | null;
};

function dash(v: unknown) {
  const s = String(v ?? '').trim();
  return s || '-';
}

export function buildBusinessCardOrderExcelRows(
  items: BusinessCardOrderExcelSource[]
): Array<Record<BusinessCardOrderHeader, string | number>> {
  return items.map((r, idx) => ({
    NO: idx + 1,
    관리번호: dash(r.postNumber),
    '수량(통)': Number(r.quantity) > 0 ? Number(r.quantity) : 1,
    성명: dash(r.userName),
    신청일자: dash(r.applyDate),
    본부: dash(r.deptHead),
    소속: dash(r.deptName),
    '직책/직급': dash(r.title),
    추가사항: dash(r.additionalKo),
    우편번호: dash(r.zipCode),
    주소: dash(r.addressKo),
    휴대전화: dash(r.mobile),
    전화번호: dash(r.phone),
    팩스: dash(r.fax),
    이메일: dash(r.email),
    영문이름: dash(r.userNameEn),
    영문본부: dash(r.deptHeadEn),
    영문소속: dash(r.deptNameEn),
    영문직책: dash(r.titleEn),
    영문추가: dash(r.additionalEn),
    영문주소: dash(r.addressEn),
    '영문 휴대전화': dash(stripBusinessCardEnPlus(r.mobileEn || '')),
    영문전화: dash(stripBusinessCardEnPlus(r.phoneEn || '')),
    영문팩스: dash(stripBusinessCardEnPlus(r.faxEn || '')),
    '이메일(영문)': dash(r.emailEn || r.email),
  }));
}

/** 명함 발주서 — 제작물 inspection 발주서와 같은 그룹행·3톤 스타일 */
export async function writeBusinessCardOrderExcelBuffer(
  items: BusinessCardOrderExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildBusinessCardOrderExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '명함발주서',
    headers: BUSINESS_CARD_ORDER_HEADERS,
    groups: BUSINESS_CARD_ORDER_GROUPS,
    rows,
    centerKeys: BUSINESS_CARD_ORDER_CENTER_KEYS,
  });
}
