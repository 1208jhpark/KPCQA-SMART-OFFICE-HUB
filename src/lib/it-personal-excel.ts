import { writeGroupedOrderExcelBuffer } from '@/lib/production-sign-excel';

/** 명함 발주서와 동일한 3톤 그룹 헤더 */
const IDENTITY_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ASSET_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const AUDIT_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const IT_PERSONAL_HEADERS = [
  'NO',
  '조직',
  '사용자',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
  '모델명',
  'S/N',
  '제조사',
  '기본 사양',
  '최근실사일',
] as const;

export type ItPersonalHeader = (typeof IT_PERSONAL_HEADERS)[number];

const IT_PERSONAL_GROUPS = [
  {
    label: '소속·사용자',
    keys: ['조직', '사용자'] as ItPersonalHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '자산정보',
    keys: [
      '범주',
      '자산 분류',
      '조달유형',
      '자산번호',
      '모델명',
      'S/N',
      '제조사',
      '기본 사양',
    ] as ItPersonalHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '실사',
    keys: ['최근실사일'] as ItPersonalHeader[],
    ...AUDIT_COLORS,
  },
];

const IT_PERSONAL_CENTER_KEYS = new Set<ItPersonalHeader>([
  'NO',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
  '최근실사일',
]);

export type ItPersonalExcelSource = {
  dept?: string | null;
  user?: string | null;
  category?: string | null;
  it_type?: string | null;
  is_rental?: string | null;
  code?: string | null;
  model?: string | null;
  sn?: string | null;
  brand?: string | null;
  spec?: string | null;
  last_audit_date?: string | null;
};

function dash(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || '-';
}

export function buildItPersonalExcelRows(
  items: ItPersonalExcelSource[]
): Record<ItPersonalHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: items.length - index,
    조직: dash(a.dept),
    사용자: dash(a.user),
    범주: dash(a.category),
    '자산 분류': dash(a.it_type),
    조달유형: dash(a.is_rental),
    자산번호: dash(a.code),
    모델명: dash(a.model),
    'S/N': dash(a.sn),
    제조사: dash(a.brand),
    '기본 사양': dash(a.spec),
    최근실사일: dash(a.last_audit_date),
  }));
}

/** IT 개인 자산 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeItPersonalExcelBuffer(
  items: ItPersonalExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItPersonalExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '나의업무자산',
    headers: IT_PERSONAL_HEADERS,
    groups: IT_PERSONAL_GROUPS,
    rows,
    centerKeys: IT_PERSONAL_CENTER_KEYS,
  });
}

export const IT_DEPT_HEADERS = [
  'NO',
  '조직',
  '사용자',
  '이메일',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
  '모델명',
  'S/N',
  '제조사',
  '기본 사양',
] as const;

export type ItDeptHeader = (typeof IT_DEPT_HEADERS)[number];

const IT_DEPT_GROUPS = [
  {
    label: '소속·사용자',
    keys: ['조직', '사용자', '이메일'] as ItDeptHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '자산정보',
    keys: [
      '범주',
      '자산 분류',
      '조달유형',
      '자산번호',
      '모델명',
      'S/N',
      '제조사',
      '기본 사양',
    ] as ItDeptHeader[],
    ...ASSET_COLORS,
  },
];

const IT_DEPT_CENTER_KEYS = new Set<ItDeptHeader>([
  'NO',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
]);

export type ItDeptExcelSource = ItPersonalExcelSource & {
  user_email?: string | null;
  /** 이미 local-part만 넘길 때 */
  emailLocal?: string | null;
};

function emailLocalPart(email: string | null | undefined) {
  const raw = String(email || '').trim();
  if (!raw) return '';
  const at = raw.indexOf('@');
  return at > 0 ? raw.slice(0, at) : raw;
}

export function buildItDeptExcelRows(
  items: ItDeptExcelSource[]
): Record<ItDeptHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: items.length - index,
    조직: dash(a.dept),
    사용자: dash(a.user),
    이메일: dash(a.emailLocal || emailLocalPart(a.user_email)),
    범주: dash(a.category),
    '자산 분류': dash(a.it_type),
    조달유형: dash(a.is_rental),
    자산번호: dash(a.code),
    모델명: dash(a.model),
    'S/N': dash(a.sn),
    제조사: dash(a.brand),
    '기본 사양': dash(a.spec),
  }));
}

/** IT 부서 자산 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeItDeptExcelBuffer(
  items: ItDeptExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItDeptExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '부서업무자산',
    headers: IT_DEPT_HEADERS,
    groups: IT_DEPT_GROUPS,
    rows,
    centerKeys: IT_DEPT_CENTER_KEYS,
  });
}

const CONTRACT_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const IT_MASTER_HEADERS = [
  'NO',
  '부서',
  '사용자',
  '이메일',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
  '모델명',
  'S/N',
  '제조사',
  '기본 사양',
  '구매/월렌탈/구독(원)',
  '입고일',
  '렌탈/구독기간(M)',
  '교체예정일',
  '관리메모',
] as const;

export type ItMasterHeader = (typeof IT_MASTER_HEADERS)[number];

const IT_MASTER_GROUPS = [
  {
    label: '소속·사용자',
    keys: ['부서', '사용자', '이메일'] as ItMasterHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '자산정보',
    keys: [
      '범주',
      '자산 분류',
      '조달유형',
      '자산번호',
      '모델명',
      'S/N',
      '제조사',
      '기본 사양',
    ] as ItMasterHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '계약·상태',
    keys: [
      '구매/월렌탈/구독(원)',
      '입고일',
      '렌탈/구독기간(M)',
      '교체예정일',
      '관리메모',
    ] as ItMasterHeader[],
    ...CONTRACT_COLORS,
  },
];

const IT_MASTER_CENTER_KEYS = new Set<ItMasterHeader>([
  'NO',
  '범주',
  '자산 분류',
  '조달유형',
  '자산번호',
  '입고일',
  '렌탈/구독기간(M)',
  '교체예정일',
]);

/** 렌탈/구독기간: 미설정(0·빈값)은 0이 아니라 '-' */
function dashRentalMonths(v: unknown): string {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return String(n);
}

/** 구매/월렌탈/구독(원): 미설정(0·빈값)은 '-' */
function dashProcureFee(v: unknown): string {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return '-';
  return String(n);
}

export type ItMasterExcelSource = {
  dept?: string | null;
  user?: string | null;
  user_email?: string | null;
  emailLocal?: string | null;
  category?: string | null;
  it_type?: string | null;
  is_rental?: string | null;
  code?: string | null;
  model?: string | null;
  sn?: string | null;
  brand?: string | null;
  spec?: string | null;
  procureFee?: string | number | null;
  in_date?: string | null;
  rental_months?: string | number | null;
  replaceDate?: string | null;
  memo?: string | null;
};

export function buildItMasterExcelRows(
  items: ItMasterExcelSource[]
): Record<ItMasterHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: index + 1,
    부서: dash(a.dept),
    사용자: dash(a.user),
    이메일: dash(a.emailLocal || emailLocalPart(a.user_email)),
    범주: dash(a.category),
    '자산 분류': dash(a.it_type),
    조달유형: dash(a.is_rental),
    자산번호: dash(a.code),
    모델명: dash(a.model),
    'S/N': dash(a.sn),
    제조사: dash(a.brand),
    '기본 사양': dash(a.spec),
    '구매/월렌탈/구독(원)': dashProcureFee(a.procureFee),
    입고일: dash(a.in_date),
    '렌탈/구독기간(M)': dashRentalMonths(a.rental_months),
    교체예정일: dash(a.replaceDate),
    관리메모: dash(a.memo),
  }));
}

/** IT 마스터 자산 — 부서/명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeItMasterExcelBuffer(
  items: ItMasterExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItMasterExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '전사업무자산',
    headers: IT_MASTER_HEADERS,
    groups: IT_MASTER_GROUPS,
    rows,
    centerKeys: IT_MASTER_CENTER_KEYS,
  });
}

export const IT_AUDIT_ARCHIVE_HEADERS = [
  'NO',
  '게시일',
  '실사명',
  '내용 요약',
  '실사 운영 기간',
  '대상범위',
] as const;

export type ItAuditArchiveHeader = (typeof IT_AUDIT_ARCHIVE_HEADERS)[number];

const IT_AUDIT_ARCHIVE_GROUPS = [
  {
    label: '실사정보',
    keys: ['게시일', '실사명', '내용 요약'] as ItAuditArchiveHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '운영범위',
    keys: ['실사 운영 기간', '대상범위'] as ItAuditArchiveHeader[],
    ...AUDIT_COLORS,
  },
];

const IT_AUDIT_ARCHIVE_CENTER_KEYS = new Set<ItAuditArchiveHeader>([
  'NO',
  '게시일',
  '실사 운영 기간',
  '대상범위',
]);

export type ItAuditArchiveExcelSource = {
  postDate?: string | null;
  title?: string | null;
  description?: string | null;
  periodLabel?: string | null;
  targetLabel?: string | null;
};

export function buildItAuditArchiveExcelRows(
  items: ItAuditArchiveExcelSource[]
): Record<ItAuditArchiveHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: index + 1,
    게시일: dash(a.postDate),
    실사명: dash(a.title),
    '내용 요약': dash(a.description),
    '실사 운영 기간': dash(a.periodLabel),
    대상범위: dash(a.targetLabel),
  }));
}

/** IT 실사 종료 이력(Archive) — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeItAuditArchiveExcelBuffer(
  items: ItAuditArchiveExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItAuditArchiveExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '실사종료이력',
    headers: IT_AUDIT_ARCHIVE_HEADERS,
    groups: IT_AUDIT_ARCHIVE_GROUPS,
    rows,
    centerKeys: IT_AUDIT_ARCHIVE_CENTER_KEYS,
  });
}

const TERMINATE_COLORS = {
  groupFill: 'FFC62828',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const IT_MASTER_ARCHIVE_HEADERS = [
  'NO',
  '종료처리일자',
  '상태',
  '종료사유',
  '부서',
  '사용자',
  '자산 분류',
  '자산번호',
  '모델명',
  'S/N',
  '반납처/매각처',
  '매각금액(원)',
] as const;

export type ItMasterArchiveHeader = (typeof IT_MASTER_ARCHIVE_HEADERS)[number];

const IT_MASTER_ARCHIVE_GROUPS = [
  {
    label: '종료정보',
    keys: ['종료처리일자', '상태', '종료사유'] as ItMasterArchiveHeader[],
    ...TERMINATE_COLORS,
  },
  {
    label: '소속·사용자',
    keys: ['부서', '사용자'] as ItMasterArchiveHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '자산정보',
    keys: ['자산 분류', '자산번호', '모델명', 'S/N'] as ItMasterArchiveHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '처분정보',
    keys: ['반납처/매각처', '매각금액(원)'] as ItMasterArchiveHeader[],
    ...AUDIT_COLORS,
  },
];

const IT_MASTER_ARCHIVE_CENTER_KEYS = new Set<ItMasterArchiveHeader>([
  'NO',
  '종료처리일자',
  '상태',
  '자산 분류',
  '매각금액(원)',
]);

export type ItMasterArchiveExcelSource = {
  terminated_at?: string | null;
  status?: string | null;
  reason?: string | null;
  dept?: string | null;
  user?: string | null;
  it_type?: string | null;
  code?: string | null;
  model?: string | null;
  sn?: string | null;
  reseller?: string | null;
  resellPrice?: string | number | null;
};

function dashResellPrice(v: unknown): string | number {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return '-';
  return n;
}

export function buildItMasterArchiveExcelRows(
  items: ItMasterArchiveExcelSource[]
): Record<ItMasterArchiveHeader, string | number>[] {
  return items.map((h, index) => ({
    NO: index + 1,
    종료처리일자: dash(
      h.terminated_at ? String(h.terminated_at).substring(0, 10) : h.terminated_at
    ),
    상태: dash(h.status === '재판매' ? '매각' : h.status),
    종료사유: dash(h.reason),
    부서: dash(h.dept),
    사용자: dash(h.user || '공용'),
    '자산 분류': dash(h.it_type),
    자산번호: dash(h.code),
    모델명: dash(h.model),
    'S/N': dash(h.sn),
    '반납처/매각처': dash(h.reseller),
    '매각금액(원)': dashResellPrice(h.resellPrice),
  }));
}

/** IT 종료 자산 아카이브 — 명함/마스터와 같은 그룹행·3톤 스타일 */
export async function writeItMasterArchiveExcelBuffer(
  items: ItMasterArchiveExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItMasterArchiveExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '종료자산대장',
    headers: IT_MASTER_ARCHIVE_HEADERS,
    groups: IT_MASTER_ARCHIVE_GROUPS,
    rows,
    centerKeys: IT_MASTER_ARCHIVE_CENTER_KEYS,
  });
}
