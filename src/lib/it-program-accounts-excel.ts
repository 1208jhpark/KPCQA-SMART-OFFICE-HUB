import { writeGroupedOrderExcelBuffer } from '@/lib/production-sign-excel';

/** 명함 발주서와 동일한 3톤 그룹 헤더 */
const PERSON_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const PROGRAM_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const NOTE_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const IT_PROGRAM_ACCOUNT_HEADERS = [
  'NO',
  '이름',
  '등록일',
  '프로그램종류',
  '프로그램 사용',
  '프로그램 아이디',
  '프로그램 비밀번호',
  'S/N',
  'IP',
  'MAC',
  '비고1',
  '비고2',
] as const;

export type ItProgramAccountHeader = (typeof IT_PROGRAM_ACCOUNT_HEADERS)[number];

const IT_PROGRAM_ACCOUNT_GROUPS = [
  {
    label: '인력',
    keys: ['이름', '등록일'] as ItProgramAccountHeader[],
    ...PERSON_COLORS,
  },
  {
    label: '프로그램',
    keys: [
      '프로그램종류',
      '프로그램 사용',
      '프로그램 아이디',
      '프로그램 비밀번호',
      'S/N',
      'IP',
      'MAC',
    ] as ItProgramAccountHeader[],
    ...PROGRAM_COLORS,
  },
  {
    label: '비고',
    keys: ['비고1', '비고2'] as ItProgramAccountHeader[],
    ...NOTE_COLORS,
  },
];

const IT_PROGRAM_ACCOUNT_CENTER_KEYS = new Set<ItProgramAccountHeader>([
  'NO',
  '등록일',
  '프로그램 사용',
]);

export type ItProgramAccountExcelSource = {
  person_name?: string | null;
  registered_date?: string | null;
  program_type?: string | null;
  program_used?: boolean | null;
  program_id?: string | null;
  program_password?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  note1?: string | null;
  note2?: string | null;
  note3?: string | null;
};

function dash(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || '-';
}

function passwordCell(raw: unknown): string {
  const pw = String(raw || '').trim();
  if (!pw) return '-';
  if (pw === '****') return '****';
  return pw;
}

export function buildItProgramAccountExcelRows(
  items: ItProgramAccountExcelSource[]
): Record<ItProgramAccountHeader, string | number>[] {
  return items.map((r, i) => ({
    NO: items.length - i,
    이름: dash(r.person_name),
    등록일: dash(r.registered_date),
    프로그램종류: dash(r.program_type),
    '프로그램 사용': r.program_used ? '사용' : '-',
    '프로그램 아이디': dash(r.program_id),
    '프로그램 비밀번호': passwordCell(r.program_password),
    'S/N': dash(r.note1),
    IP: dash(r.ip_address),
    MAC: dash(r.mac_address),
    비고1: dash(r.note2),
    비고2: dash(r.note3),
  }));
}

/** 부서 인력별 프로그램 사용 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeItProgramAccountsExcelBuffer(
  items: ItProgramAccountExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildItProgramAccountExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '프로그램사용',
    headers: IT_PROGRAM_ACCOUNT_HEADERS,
    groups: IT_PROGRAM_ACCOUNT_GROUPS,
    rows,
    centerKeys: IT_PROGRAM_ACCOUNT_CENTER_KEYS,
  });
}
