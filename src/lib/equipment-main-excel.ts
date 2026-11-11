import {
  writeGroupedOrderExcelBuffer,
  writeMultiGroupedOrderExcelBuffer,
} from '@/lib/production-sign-excel';

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
const SCHEDULE_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

export const EQUIPMENT_MAIN_HEADERS = [
  'NO',
  '자산번호',
  '품목명',
  '제조사',
  '모델번호',
  '시리얼번호',
  '보유개수',
  '구매일',
  '검교정예정일',
  '장비관리소속',
] as const;

export type EquipmentMainHeader = (typeof EQUIPMENT_MAIN_HEADERS)[number];

const EQUIPMENT_MAIN_GROUPS = [
  {
    label: '식별',
    keys: ['자산번호', '품목명'] as EquipmentMainHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '장비정보',
    keys: ['제조사', '모델번호', '시리얼번호', '보유개수'] as EquipmentMainHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '일정·소속',
    keys: ['구매일', '검교정예정일', '장비관리소속'] as EquipmentMainHeader[],
    ...SCHEDULE_COLORS,
  },
];

const EQUIPMENT_MAIN_CENTER_KEYS = new Set<EquipmentMainHeader>([
  'NO',
  '보유개수',
  '구매일',
  '검교정예정일',
]);

function dash(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || '-';
}

export type EquipmentMainExcelSource = {
  asset_no?: string | null;
  name?: string | null;
  brand?: string | null;
  model_name?: string | null;
  serial_no?: string | null;
  qty?: string | number | null;
  purchase_date?: string | null;
  calibDue?: string | null;
  department?: string | null;
};

export function buildEquipmentMainExcelRows(
  items: EquipmentMainExcelSource[]
): Record<EquipmentMainHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: index + 1,
    자산번호: dash(a.asset_no),
    품목명: dash(a.name),
    제조사: dash(a.brand),
    모델번호: dash(a.model_name),
    시리얼번호: dash(a.serial_no),
    보유개수: dash(a.qty),
    구매일: dash(a.purchase_date),
    검교정예정일: dash(a.calibDue),
    장비관리소속: dash(a.department),
  }));
}

/** 전사 장비 관제탑 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeEquipmentMainExcelBuffer(
  items: EquipmentMainExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildEquipmentMainExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '전체장비',
    headers: EQUIPMENT_MAIN_HEADERS,
    groups: EQUIPMENT_MAIN_GROUPS,
    rows,
    centerKeys: EQUIPMENT_MAIN_CENTER_KEYS,
  });
}

export const EQUIPMENT_ARCHIVE_HEADERS = [
  'NO',
  '처리일자',
  '자산번호',
  '품목명',
  '폐기/반납개수',
  '관리소속',
  '상태',
] as const;

export type EquipmentArchiveHeader = (typeof EQUIPMENT_ARCHIVE_HEADERS)[number];

const EQUIPMENT_ARCHIVE_GROUPS = [
  {
    label: '식별',
    keys: ['처리일자', '자산번호', '품목명'] as EquipmentArchiveHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '처리내용',
    keys: ['폐기/반납개수'] as EquipmentArchiveHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '소속·상태',
    keys: ['관리소속', '상태'] as EquipmentArchiveHeader[],
    ...SCHEDULE_COLORS,
  },
];

const EQUIPMENT_ARCHIVE_CENTER_KEYS = new Set<EquipmentArchiveHeader>([
  'NO',
  '처리일자',
  '폐기/반납개수',
  '상태',
]);

export type EquipmentArchiveExcelSource = {
  processedAt?: string | null;
  asset_no?: string | null;
  name?: string | null;
  qty?: string | number | null;
  department?: string | null;
  status?: string | null;
};

export function buildEquipmentArchiveExcelRows(
  items: EquipmentArchiveExcelSource[]
): Record<EquipmentArchiveHeader, string | number>[] {
  return items.map((a, index) => ({
    NO: index + 1,
    처리일자: dash(a.processedAt),
    자산번호: dash(a.asset_no),
    품목명: dash(a.name),
    '폐기/반납개수': dash(a.qty),
    관리소속: dash(a.department),
    상태: dash(a.status),
  }));
}

/** 장비 폐기/반납함 — 명함 발주서와 같은 그룹행·3톤 스타일 */
export async function writeEquipmentArchiveExcelBuffer(
  items: EquipmentArchiveExcelSource[],
  opts?: { sheetName?: string }
): Promise<ArrayBuffer> {
  const rows = buildEquipmentArchiveExcelRows(items);
  return writeGroupedOrderExcelBuffer({
    sheetName: opts?.sheetName || '장비폐기반납함',
    headers: EQUIPMENT_ARCHIVE_HEADERS,
    groups: EQUIPMENT_ARCHIVE_GROUPS,
    rows,
    centerKeys: EQUIPMENT_ARCHIVE_CENTER_KEYS,
  });
}

export const EQUIPMENT_DETAIL_SUMMARY_HEADERS = [
  'NO',
  '자산번호',
  '품목명',
  '장비종류범주',
  '장비관리소속',
  '제조사',
  '모델번호',
  '시리얼번호',
  '보유개수',
  '제품사양',
  '구매일',
  '최근교체/수리일',
  '교체주기(M)',
  '교체예정일',
  '최근검교정요청일',
  '최근검교정확정일',
  '검교정주기(M)',
  '검교정예정일',
  '폐기/반납개수',
  '사유',
  '처리자',
  '일자',
] as const;

export type EquipmentDetailSummaryHeader = (typeof EQUIPMENT_DETAIL_SUMMARY_HEADERS)[number];

const EQUIPMENT_DETAIL_SUMMARY_GROUPS = [
  {
    label: '식별',
    keys: ['자산번호', '품목명', '장비종류범주', '장비관리소속'] as EquipmentDetailSummaryHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '장비정보',
    keys: ['제조사', '모델번호', '시리얼번호', '보유개수', '제품사양'] as EquipmentDetailSummaryHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '구매 및 교체이력',
    keys: [
      '구매일',
      '최근교체/수리일',
      '교체주기(M)',
      '교체예정일',
    ] as EquipmentDetailSummaryHeader[],
    ...SCHEDULE_COLORS,
  },
  {
    label: '검교정',
    keys: [
      '최근검교정요청일',
      '최근검교정확정일',
      '검교정주기(M)',
      '검교정예정일',
    ] as EquipmentDetailSummaryHeader[],
    groupFill: 'FF2E7D32',
    headerFill: 'FFF1F3F5',
    dataFill: 'FFFFFFFF',
    dataAlt: 'FFFFFFFF',
  },
  {
    label: '폐기관리',
    keys: ['폐기/반납개수', '사유', '처리자', '일자'] as EquipmentDetailSummaryHeader[],
    groupFill: 'FFC62828',
    headerFill: 'FFF1F3F5',
    dataFill: 'FFFFFFFF',
    dataAlt: 'FFFFFFFF',
  },
];

const EQUIPMENT_DETAIL_SUMMARY_CENTER_KEYS = new Set<EquipmentDetailSummaryHeader>([
  'NO',
  '보유개수',
  '구매일',
  '최근교체/수리일',
  '교체주기(M)',
  '교체예정일',
  '최근검교정요청일',
  '최근검교정확정일',
  '검교정주기(M)',
  '검교정예정일',
  '폐기/반납개수',
  '일자',
]);

export const EQUIPMENT_DETAIL_CALIB_HEADERS = [
  'NO',
  '검교정요청일',
  '검교정확정일',
  '검교정내용',
  '결과상태',
  '교정기관',
  '발생비용',
  '등록자',
  '등록자소속',
  '등록일',
] as const;

export type EquipmentDetailCalibHeader = (typeof EQUIPMENT_DETAIL_CALIB_HEADERS)[number];

const EQUIPMENT_DETAIL_CALIB_GROUPS = [
  {
    label: '일정',
    keys: ['검교정요청일', '검교정확정일'] as EquipmentDetailCalibHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '내용',
    keys: ['검교정내용', '결과상태', '교정기관', '발생비용'] as EquipmentDetailCalibHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '등록',
    keys: ['등록자', '등록자소속', '등록일'] as EquipmentDetailCalibHeader[],
    ...SCHEDULE_COLORS,
  },
];

const EQUIPMENT_DETAIL_CALIB_CENTER_KEYS = new Set<EquipmentDetailCalibHeader>([
  'NO',
  '검교정요청일',
  '검교정확정일',
  '결과상태',
  '발생비용',
  '등록일',
]);

export const EQUIPMENT_DETAIL_MAINT_HEADERS = [
  'NO',
  '처리일자',
  '구분',
  '상세내용',
  '업체명',
  '발생비용',
  '등록자',
  '등록자소속',
  '등록일',
] as const;

export type EquipmentDetailMaintHeader = (typeof EQUIPMENT_DETAIL_MAINT_HEADERS)[number];

const EQUIPMENT_DETAIL_MAINT_GROUPS = [
  {
    label: '처리',
    keys: ['처리일자', '구분'] as EquipmentDetailMaintHeader[],
    ...IDENTITY_COLORS,
  },
  {
    label: '내용',
    keys: ['상세내용', '업체명', '발생비용'] as EquipmentDetailMaintHeader[],
    ...ASSET_COLORS,
  },
  {
    label: '등록',
    keys: ['등록자', '등록자소속', '등록일'] as EquipmentDetailMaintHeader[],
    ...SCHEDULE_COLORS,
  },
];

const EQUIPMENT_DETAIL_MAINT_CENTER_KEYS = new Set<EquipmentDetailMaintHeader>([
  'NO',
  '처리일자',
  '구분',
  '발생비용',
  '등록일',
]);

const EQUIPMENT_DETAIL_DISPOSE_HEADERS = [
  '폐기/반납개수',
  '사유',
  '처리자',
  '일자',
] as const satisfies readonly EquipmentDetailSummaryHeader[];

export type EquipmentDetailExcelPayload = {
  summary: Partial<Record<EquipmentDetailSummaryHeader, string | number>> &
    Record<
      Exclude<EquipmentDetailSummaryHeader, (typeof EQUIPMENT_DETAIL_DISPOSE_HEADERS)[number]>,
      string | number
    >;
  calibRows: Array<Record<EquipmentDetailCalibHeader, string | number>>;
  maintRows: Array<Record<EquipmentDetailMaintHeader, string | number>>;
};

/** 장비 상세 — 요약/검교정/구매유지보수 3시트 · 명함 스타일 */
export async function writeEquipmentDetailExcelBuffer(
  payload: EquipmentDetailExcelPayload,
  opts?: { includeDisposeFields?: boolean }
): Promise<ArrayBuffer> {
  const includeDispose = opts?.includeDisposeFields === true;
  const summaryHeaders = includeDispose
    ? [...EQUIPMENT_DETAIL_SUMMARY_HEADERS]
    : EQUIPMENT_DETAIL_SUMMARY_HEADERS.filter(
        (h) => !(EQUIPMENT_DETAIL_DISPOSE_HEADERS as readonly string[]).includes(h)
      );
  const summaryGroups = includeDispose
    ? EQUIPMENT_DETAIL_SUMMARY_GROUPS
    : EQUIPMENT_DETAIL_SUMMARY_GROUPS.filter((g) => g.label !== '폐기관리');

  return writeMultiGroupedOrderExcelBuffer([
    {
      sheetName: '장비상세',
      headers: summaryHeaders,
      groups: summaryGroups,
      rows: [payload.summary],
      centerKeys: EQUIPMENT_DETAIL_SUMMARY_CENTER_KEYS,
    },
    {
      sheetName: '검교정이력',
      headers: EQUIPMENT_DETAIL_CALIB_HEADERS,
      groups: EQUIPMENT_DETAIL_CALIB_GROUPS,
      rows: payload.calibRows,
      centerKeys: EQUIPMENT_DETAIL_CALIB_CENTER_KEYS,
      extraEmptyRows: payload.calibRows.length === 0 ? 1 : 0,
    },
    {
      sheetName: '구매유지보수',
      headers: EQUIPMENT_DETAIL_MAINT_HEADERS,
      groups: EQUIPMENT_DETAIL_MAINT_GROUPS,
      rows: payload.maintRows,
      centerKeys: EQUIPMENT_DETAIL_MAINT_CENTER_KEYS,
      extraEmptyRows: payload.maintRows.length === 0 ? 1 : 0,
    },
  ]);
}
