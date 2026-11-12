import {
  createGroupedOrderWorkbook,
  writeGroupedOrderExcelBuffer,
  type OrderExcelGroup,
} from '@/lib/production-sign-excel';
import { COMPANY_EMAIL_SUFFIX } from '@/utils/companyEmail';

/** 명함 외주 발주서와 동일한 3톤 그룹 헤더 */
const BASIC_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ORG_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ACCOUNT_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

function dash(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || '-';
}

export const ADMIN_USER_LIST_HEADERS = [
  'NO',
  '이메일',
  '성명(한글)',
  '성명(영문)',
  '사번',
  '내선번호',
  '소속',
  '직책(한글)',
  '직책(영문)',
  '직급(한글)',
  '직급(영문)',
  '권한',
  '상태',
  '임시PW상태',
  'PW초기화요청',
] as const;

export type AdminUserListHeader = (typeof ADMIN_USER_LIST_HEADERS)[number];

const ADMIN_USER_LIST_GROUPS: OrderExcelGroup<AdminUserListHeader>[] = [
  {
    label: '기본정보',
    keys: ['이메일', '성명(한글)', '성명(영문)', '사번', '내선번호'],
    ...BASIC_COLORS,
  },
  {
    label: '소속·직책',
    keys: ['소속', '직책(한글)', '직책(영문)', '직급(한글)', '직급(영문)'],
    ...ORG_COLORS,
  },
  {
    label: '계정상태',
    keys: ['권한', '상태', '임시PW상태', 'PW초기화요청'],
    ...ACCOUNT_COLORS,
  },
];

const ADMIN_USER_LIST_CENTER = new Set<AdminUserListHeader>([
  'NO',
  '사번',
  '내선번호',
  '권한',
  '상태',
  '임시PW상태',
  'PW초기화요청',
]);

export type AdminUserExcelSource = {
  email?: string | null;
  name?: string | null;
  name_en?: string | null;
  employee_no?: string | null;
  extension?: string | null;
  unitLabel?: string | null;
  duty?: string | null;
  duty_en?: string | null;
  grade?: string | null;
  grade_en?: string | null;
  rolesLabel?: string | null;
  status?: string | null;
  mustResetPassword?: boolean;
  passwordResetRequested?: boolean;
};

export function buildAdminUserListExcelRows(
  items: AdminUserExcelSource[]
): Array<Record<AdminUserListHeader, string | number>> {
  return items.map((u, idx) => ({
    NO: idx + 1,
    이메일: dash(u.email),
    '성명(한글)': dash(u.name),
    '성명(영문)': dash(u.name_en),
    사번: dash(u.employee_no),
    내선번호: dash(u.extension),
    소속: dash(u.unitLabel),
    '직책(한글)': dash(u.duty),
    '직책(영문)': dash(u.duty_en),
    '직급(한글)': dash(u.grade),
    '직급(영문)': dash(u.grade_en),
    권한: dash(u.rolesLabel),
    상태: dash(u.status),
    임시PW상태: u.mustResetPassword ? 'Y' : 'N',
    PW초기화요청: u.passwordResetRequested ? 'Y' : 'N',
  }));
}

/** 계정자 목록 — 명함 외주 발주서와 같은 그룹행·3톤 스타일 */
export async function writeAdminUserListExcelBuffer(
  items: AdminUserExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildAdminUserListExcelRows(items);
  if (rows.length === 0) throw new Error('NO_DATA');
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '계정자목록',
    headers: ADMIN_USER_LIST_HEADERS,
    groups: ADMIN_USER_LIST_GROUPS,
    rows,
    centerKeys: ADMIN_USER_LIST_CENTER,
  });
}

export function downloadAdminUserListExcel(buffer: ArrayBuffer, filename: string) {
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

/** 신규 인원 엑셀 업로드 양식 헤더 (신규추가 모달 필드와 동일) */
export const ADMIN_USER_UPLOAD_HEADERS = [
  'NO',
  '성명(한글)',
  '성명(영문)',
  '사내메일앞자리',
  '사번',
  '내선번호',
  '소속',
  '권한레벨',
  '직책',
  '직급',
  '계정상태',
] as const;

export type AdminUserUploadHeader = (typeof ADMIN_USER_UPLOAD_HEADERS)[number];

const ADMIN_USER_UPLOAD_GROUPS: OrderExcelGroup<AdminUserUploadHeader>[] = [
  {
    label: '기본정보',
    keys: ['성명(한글)', '성명(영문)', '사내메일앞자리', '사번', '내선번호'],
    ...BASIC_COLORS,
  },
  {
    label: '소속·권한',
    keys: ['소속', '권한레벨', '직책', '직급', '계정상태'],
    ...ORG_COLORS,
  },
];

const ADMIN_USER_UPLOAD_CENTER = new Set<AdminUserUploadHeader>([
  'NO',
  '사번',
  '내선번호',
  '권한레벨',
  '계정상태',
]);

const ADMIN_USER_UPLOAD_DATA_ROWS = 200;
const UNIT_NONE_LABEL = '조직 미지정';
const ROLE_OPTIONS = ['LV_3', 'LV_2', 'LV_1'] as const;
const STATUS_OPTIONS = ['Active', 'Suspended'] as const;

function applyListValidation(
  sheet: import('exceljs').Worksheet,
  colIndex: number,
  listSheetName: string,
  listEnd: number,
  title: string,
  allowBlank: boolean
) {
  const dataStart = 3;
  const dataEnd = 2 + ADMIN_USER_UPLOAD_DATA_ROWS;
  const formula = `'${listSheetName}'!$A$1:$A$${Math.max(listEnd, 1)}`;
  for (let r = dataStart; r <= dataEnd; r += 1) {
    sheet.getCell(r, colIndex).dataValidation = {
      type: 'list',
      allowBlank,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: title,
      error: `${title} 목록에서 선택해 주세요.`,
      showInputMessage: true,
      promptTitle: title,
      prompt: '드롭다운에서 선택',
    };
  }
}

function addHiddenListSheet(
  workbook: import('exceljs').Workbook,
  name: string,
  values: string[]
) {
  const listSheet = workbook.addWorksheet(name);
  const vals = values.map((v) => String(v || '').trim()).filter(Boolean);
  if (vals.length === 0) vals.push('-');
  vals.forEach((v, i) => {
    listSheet.getCell(i + 1, 1).value = v;
  });
  listSheet.getColumn(1).width = 28;
  listSheet.state = 'hidden';
  return vals.length;
}

/** 신규 인원 업로드 양식 — 소속·권한·직책·직급·상태는 드롭다운 */
export async function writeAdminUserUploadTemplateBuffer(opts: {
  unitNames: string[];
  dutyLabels: string[];
  gradeLabels: string[];
}): Promise<ArrayBuffer> {
  const unitChoices = [UNIT_NONE_LABEL, ...opts.unitNames.filter(Boolean)];
  const dutyChoices = ['직책 없음', ...opts.dutyLabels.filter(Boolean)];
  const gradeChoices = ['직급 미지정', ...opts.gradeLabels.filter(Boolean)];

  const sampleRow: Record<AdminUserUploadHeader, string | number> = {
    NO: 1,
    '성명(한글)': '홍길동',
    '성명(영문)': 'Gil-dong Hong',
    사내메일앞자리: 'honggd',
    사번: '',
    내선번호: '02-6973-0000',
    소속: UNIT_NONE_LABEL,
    권한레벨: 'LV_3',
    직책: dutyChoices[1] || '직책 없음',
    직급: gradeChoices[1] || '직급 미지정',
    계정상태: 'Active',
  };

  const { workbook, sheet } = await createGroupedOrderWorkbook({
    sheetName: '계정자등록',
    headers: ADMIN_USER_UPLOAD_HEADERS,
    groups: ADMIN_USER_UPLOAD_GROUPS,
    rows: [sampleRow],
    centerKeys: ADMIN_USER_UPLOAD_CENTER,
    emptyCell: '',
    extraEmptyRows: ADMIN_USER_UPLOAD_DATA_ROWS - 1,
  });
  workbook.creator = 'KPCQA WISE';

  const unitEnd = addHiddenListSheet(workbook, '소속목록', unitChoices);
  const roleEnd = addHiddenListSheet(workbook, '권한목록', [...ROLE_OPTIONS]);
  const dutyEnd = addHiddenListSheet(workbook, '직책목록', dutyChoices);
  const gradeEnd = addHiddenListSheet(workbook, '직급목록', gradeChoices);
  const statusEnd = addHiddenListSheet(workbook, '상태목록', [...STATUS_OPTIONS]);

  applyListValidation(
    sheet,
    ADMIN_USER_UPLOAD_HEADERS.indexOf('소속') + 1,
    '소속목록',
    unitEnd,
    '소속',
    true
  );
  applyListValidation(
    sheet,
    ADMIN_USER_UPLOAD_HEADERS.indexOf('권한레벨') + 1,
    '권한목록',
    roleEnd,
    '권한레벨',
    false
  );
  applyListValidation(
    sheet,
    ADMIN_USER_UPLOAD_HEADERS.indexOf('직책') + 1,
    '직책목록',
    dutyEnd,
    '직책',
    true
  );
  applyListValidation(
    sheet,
    ADMIN_USER_UPLOAD_HEADERS.indexOf('직급') + 1,
    '직급목록',
    gradeEnd,
    '직급',
    true
  );
  applyListValidation(
    sheet,
    ADMIN_USER_UPLOAD_HEADERS.indexOf('계정상태') + 1,
    '상태목록',
    statusEnd,
    '계정상태',
    false
  );

  const guide = workbook.addWorksheet('작성안내');
  guide.getCell(1, 1).value = '계정자(신규 인원) 엑셀 등록 안내';
  guide.getCell(1, 1).font = { bold: true, size: 13 };
  guide.getCell(3, 1).value = '1) 「계정자등록」시트에 입력한 뒤 업로드하세요.';
  guide.getCell(4, 1).value = `2) 사내메일은 앞자리만 입력합니다. (자동으로 ${COMPANY_EMAIL_SUFFIX} 붙음)`;
  guide.getCell(5, 1).value =
    '3) 소속·권한레벨·직책·직급·계정상태는 드롭다운에서 선택하세요. (신규추가 화면과 동일)';
  guide.getCell(6, 1).value =
    '4) 3행 예시는 업로드되지 않습니다. 4행부터 실제 데이터를 입력하세요.';
  guide.getCell(7, 1).value =
    '5) 이미 등록된 이메일·엑셀 안 중복 이메일은 자동으로 걸러집니다. 사번이 있으면 사번이 임시 비밀번호가 됩니다.';
  guide.getCell(8, 1).value =
    '6) 소속 「조직 미지정」·직책 「직책 없음」·직급 「직급 미지정」은 비움과 같습니다.';
  guide.getColumn(1).width = 88;

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export type AdminUserUploadRow = {
  name: string;
  name_en: string;
  emailLocal: string;
  employee_no: string;
  extension: string;
  unitName: string;
  role: string;
  duty: string;
  grade: string;
  status: string;
};

export function normalizeAdminUserUploadDuty(raw: string): string {
  const s = String(raw || '').trim();
  if (!s || s === '직책 없음') return '';
  return s;
}

export function normalizeAdminUserUploadGrade(raw: string): string {
  const s = String(raw || '').trim();
  if (!s || s === '직급 미지정') return '';
  return s;
}

export function normalizeAdminUserUploadUnitName(raw: string): string {
  const s = String(raw || '').trim();
  if (!s || s === UNIT_NONE_LABEL) return '';
  return s;
}
