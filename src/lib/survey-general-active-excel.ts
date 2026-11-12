import {
  createGroupedOrderWorkbook,
  writeGroupedOrderExcelBuffer,
  writeMultiGroupedOrderExcelBuffer,
  type OrderExcelGroup,
} from '@/lib/production-sign-excel';

/** 명함 발주서와 동일한 3톤 */
const SUBMIT_COLORS = {
  groupFill: 'FF546E7A',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const ANSWER_COLORS = {
  groupFill: 'FF3949AB',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const STAT_COLORS = {
  groupFill: 'FF673AB7',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;
const GRAPH_COLORS = {
  groupFill: 'FF00897B',
  headerFill: 'FFF1F3F5',
  dataFill: 'FFFFFFFF',
  dataAlt: 'FFFFFFFF',
} as const;

const GRID = 'FFD9D9D9';
const TEXT = 'FF333333';
const NO_FILL = 'FF546E7A';
const SUMMARY_FILL = 'FFFFF3E0';
const AVERAGE_FILL = 'FFE8F5E9';

function dash(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') {
    const ans = v as Record<string, unknown>;
    if (ans.fileName) return `[첨부파일] ${String(ans.fileName)}`;
    if (ans.zipCode || ans.roadAddress || ans.detailAddress) {
      const zip = ans.zipCode ? `[우편번호: ${ans.zipCode}] ` : '';
      const road = String(ans.roadAddress || '');
      const detail = ans.detailAddress ? ` ${ans.detailAddress}` : '';
      return `${zip}${road}${detail}`.trim() || '-';
    }
  }
  if (Array.isArray(v)) {
    const joined = v.map((x) => String(x)).join(', ').trim();
    return joined || '-';
  }
  const s = String(v).trim();
  return s || '-';
}

export function formatSurveyAnswerForExcel(ans: unknown): string {
  if (ans === null || ans === undefined || ans === '') return '-';
  return dash(ans);
}

export function surveyQuestionTypeLabel(type: string): string {
  if (type === 'CHOICE_SINGLE') return '단일선택';
  if (type === 'CHOICE_MULTI') return '다중선택';
  if (type === 'SCALE') return '만족도';
  if (type === 'TEXT_SHORT') return '단답형';
  if (type === 'TEXT_LONG') return '장문형';
  if (type === 'FILE') return '파일첨부';
  if (type === 'SEARCH_ADDRESS') return '주소검색';
  if (type === 'CALENDAR') return '캘린더';
  if (type === 'SECTION') return '섹션';
  return type || '-';
}

function uniqueSheetName(base: string, used: Set<string>): string {
  let name = String(base || 'Sheet').replace(/[/\\?*[\]:]/g, '-').substring(0, 31);
  if (!name) name = 'Sheet';
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = `_${i++}`;
    candidate = `${name.substring(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function uniqueHeaderKeys(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((raw) => {
    const base = String(raw || '').trim() || '(제목 없음)';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

export type SurveyExcelAnswerSource = {
  dept: string;
  name: string;
  date: string;
  /** 배송: 확인완료일(승인일) */
  approvedAt?: string;
  answers: Record<string, unknown>;
};

export type SurveyExcelQuestion = {
  id: string;
  title?: string;
  type?: string;
};

/** general: 제출자/제출일 · delivery: 신청자/확인요청일/확인완료일 */
export type SurveyExcelResponseVariant = 'general' | 'delivery';

type GroupedSheet = {
  sheetName: string;
  headers: readonly string[];
  groups: OrderExcelGroup<string>[];
  rows: Array<Record<string, string | number>>;
  centerKeys: ReadonlySet<string>;
};

function buildResponseSheet(opts: {
  sheetName: string;
  questions: SurveyExcelQuestion[];
  sources: SurveyExcelAnswerSource[];
  variant?: SurveyExcelResponseVariant;
}): GroupedSheet {
  const variant = opts.variant || 'general';
  const qKeys = uniqueHeaderKeys(
    opts.questions.map(
      (q) => `[${surveyQuestionTypeLabel(String(q.type || ''))}] ${String(q.title || '').trim() || '(제목 없음)'}`
    )
  );

  const identityKeys =
    variant === 'delivery'
      ? (['제출조직', '신청자', '확인요청일', '확인완료일'] as const)
      : (['제출조직', '제출자', '제출일'] as const);

  const headers = ['NO', ...identityKeys, ...qKeys] as const;
  const rows = opts.sources.map((src, i) => {
    const row: Record<string, string | number> = {
      NO: i + 1,
      제출조직: dash(src.dept),
    };
    if (variant === 'delivery') {
      row['신청자'] = dash(src.name);
      row['확인요청일'] = dash(src.date);
      row['확인완료일'] = dash(src.approvedAt || '미확인');
    } else {
      row['제출자'] = dash(src.name);
      row['제출일'] = dash(src.date);
    }
    opts.questions.forEach((q, qi) => {
      row[qKeys[qi]] = formatSurveyAnswerForExcel(src.answers?.[q.id]);
    });
    return row;
  });

  const groups: OrderExcelGroup<string>[] = [
    {
      label: '제출정보',
      keys: [...identityKeys],
      ...SUBMIT_COLORS,
    },
  ];
  if (qKeys.length > 0) {
    groups.push({
      label: '응답내용',
      keys: qKeys,
      ...ANSWER_COLORS,
    });
  }

  return {
    sheetName: opts.sheetName,
    headers,
    groups,
    rows,
    centerKeys: new Set(
      variant === 'delivery'
        ? ['NO', '확인요청일', '확인완료일']
        : ['NO', '제출일']
    ),
  };
}

export type SurveyStatLine = {
  option: string;
  count: string | number;
  pct: string | number;
  graph?: string;
  /** option: 일반 / summary: 응답자 수 / average: 평균 / guide: 안내 */
  kind?: 'option' | 'summary' | 'average' | 'guide';
};

export type SurveyStatBlock = {
  questionNo: number;
  question: string;
  typeLabel: string;
  lines: SurveyStatLine[];
};

export function makeSurveyPctBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round(clamped / 5);
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
}

async function appendSurveyStatSheet(
  workbook: import('exceljs').Workbook,
  sheetName: string,
  blocks: SurveyStatBlock[],
  meta?: { surveyTitle?: string; responseCount?: number }
) {
  const sheet = workbook.addWorksheet(sheetName);
  const gridLine = { style: 'thin' as const, color: { argb: GRID } };
  const gridBorder = { top: gridLine, left: gridLine, bottom: gridLine, right: gridLine };
  const groupFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: '맑은 고딕' };
  const titleFont = { bold: true, color: { argb: TEXT }, size: 10, name: '맑은 고딕' };
  const dataFont = { size: 10, name: '맑은 고딕', color: { argb: TEXT } };

  const headers = ['NO', '문항', '유형', '보기/점수', '응답수', '비율(%)', '그래프'] as const;
  const groups: Array<{ label: string; start: number; end: number; fill: string }> = [
    { label: '문항정보', start: 2, end: 4, fill: SUBMIT_COLORS.groupFill },
    { label: '통계', start: 5, end: 6, fill: STAT_COLORS.groupFill },
    { label: '그래프', start: 7, end: 7, fill: GRAPH_COLORS.groupFill },
  ];

  let rowPtr = 1;
  if (meta?.surveyTitle) {
    const metaRow = sheet.getRow(rowPtr++);
    metaRow.getCell(1).value = '설문명';
    metaRow.getCell(2).value = meta.surveyTitle;
    metaRow.font = dataFont;
    metaRow.height = 20;
  }
  if (meta?.responseCount != null) {
    const metaRow = sheet.getRow(rowPtr++);
    metaRow.getCell(1).value = '응답 인원';
    metaRow.getCell(2).value = meta.responseCount;
    metaRow.font = dataFont;
    metaRow.height = 20;
  }
  if (rowPtr > 1) rowPtr += 1; // blank spacer

  const groupRowIdx = rowPtr;
  const titleRowIdx = rowPtr + 1;
  const groupRow = sheet.getRow(groupRowIdx);
  const titleRow = sheet.getRow(titleRowIdx);
  groupRow.height = 26;
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
  paintHeader(noCell, NO_FILL, groupFont);
  sheet.mergeCells(groupRowIdx, 1, titleRowIdx, 1);

  for (const g of groups) {
    for (let c = g.start; c <= g.end; c += 1) {
      paintHeader(groupRow.getCell(c), g.fill, groupFont);
    }
    groupRow.getCell(g.start).value = g.label;
    if (g.end > g.start) sheet.mergeCells(groupRowIdx, g.start, groupRowIdx, g.end);
  }

  headers.forEach((key, idx) => {
    if (key === 'NO') return;
    const cell = titleRow.getCell(idx + 1);
    cell.value = key;
    const fill =
      idx + 1 <= 4
        ? SUBMIT_COLORS.headerFill
        : idx + 1 <= 6
          ? STAT_COLORS.headerFill
          : GRAPH_COLORS.headerFill;
    paintHeader(cell, fill, titleFont);
  });

  let dataStart = titleRowIdx + 1;
  for (const block of blocks) {
    block.lines.forEach((line, lineIdx) => {
      const excelRow = sheet.getRow(dataStart++);
      excelRow.height = 22;
      const values: Array<string | number> = [
        lineIdx === 0 ? block.questionNo : '',
        lineIdx === 0 ? dash(block.question) : '',
        lineIdx === 0 ? dash(block.typeLabel) : '',
        dash(line.option),
        line.count === '' || line.count == null ? '-' : line.count,
        line.pct === '' || line.pct == null ? '-' : line.pct,
        line.graph || '',
      ];
      const kind = line.kind || 'option';
      const fill =
        kind === 'summary'
          ? SUMMARY_FILL
          : kind === 'average'
            ? AVERAGE_FILL
            : 'FFFFFFFF';
      values.forEach((v, i) => {
        const cell = excelRow.getCell(i + 1);
        cell.value = v;
        cell.font =
          kind === 'summary' || kind === 'average'
            ? { ...dataFont, bold: true }
            : dataFont;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.border = gridBorder;
        cell.alignment = {
          vertical: 'middle',
          horizontal: i === 0 || i === 2 || i === 4 || i === 5 ? 'center' : 'left',
          wrapText: true,
        };
      });
    });
  }

  // A(NO)·B(문항)·G(그래프) 줄바꿈 방지
  const widths = [12, 48, 12, 22, 10, 10, 42];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: titleRowIdx, topLeftCell: `A${titleRowIdx + 1}` }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: false };
  return workbook;
}

export async function writeSurveyResponseExcelBuffer(
  sheets: Array<{
    title: string;
    questions: SurveyExcelQuestion[];
    sources: SurveyExcelAnswerSource[];
  }>,
  opts?: { variant?: SurveyExcelResponseVariant }
): Promise<ArrayBuffer> {
  const used = new Set<string>();
  const variant = opts?.variant || 'general';
  const built = sheets
    .filter((s) => s.sources.length > 0)
    .map((s) =>
      buildResponseSheet({
        sheetName: uniqueSheetName(s.title, used),
        questions: s.questions,
        sources: s.sources,
        variant,
      })
    );
  if (built.length === 0) throw new Error('NO_DATA');
  return writeMultiGroupedOrderExcelBuffer(built);
}

export async function writeSurveyResultAnalysisExcelBuffer(
  packs: Array<{
    title: string;
    responseCount: number;
    blocks: SurveyStatBlock[];
    textQuestions: SurveyExcelQuestion[];
    sources: SurveyExcelAnswerSource[];
  }>,
  opts?: { variant?: SurveyExcelResponseVariant }
): Promise<ArrayBuffer> {
  const used = new Set<string>();
  const variant = opts?.variant || 'general';
  const ExcelJS = (await import('exceljs')).default;
  let workbook: import('exceljs').Workbook | undefined;
  let sheetCount = 0;

  for (const pack of packs) {
    if (pack.blocks.length > 0) {
      if (!workbook) workbook = new ExcelJS.Workbook();
      await appendSurveyStatSheet(
        workbook,
        uniqueSheetName(`통계_${pack.title}`, used),
        pack.blocks,
        { surveyTitle: pack.title, responseCount: pack.responseCount }
      );
      sheetCount += 1;
    }
    if (pack.textQuestions.length > 0 && pack.sources.length > 0) {
      const textSheet = buildResponseSheet({
        sheetName: uniqueSheetName(`서술_${pack.title}`, used),
        questions: pack.textQuestions,
        sources: pack.sources,
        variant,
      });
      const created = await createGroupedOrderWorkbook({
        ...textSheet,
        workbook,
      });
      workbook = created.workbook;
      sheetCount += 1;
    }
  }

  if (!workbook || sheetCount === 0) throw new Error('NO_SHEETS');
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function downloadExcelArrayBuffer(buffer: ArrayBuffer, filename: string) {
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

/** 일반조사 보관함 화면 목록 — 결과엑셀과 같은 그룹행·3톤 (보관상태 제외) */
export const SURVEY_HISTORY_LIST_HEADERS = [
  'NO',
  '식별코드',
  '게시일',
  '게시명',
  '유형',
  '익명여부',
  '대상',
  '시작일',
  '종료일',
  '참여율',
  '참여인원',
  '미참여인원',
] as const;

export type SurveyHistoryListHeader = (typeof SURVEY_HISTORY_LIST_HEADERS)[number];

const SURVEY_HISTORY_LIST_GROUPS: OrderExcelGroup<SurveyHistoryListHeader>[] = [
  {
    label: '공고정보',
    keys: ['식별코드', '게시일', '게시명', '유형', '익명여부', '대상'],
    ...SUBMIT_COLORS,
  },
  {
    label: '기간',
    keys: ['시작일', '종료일'],
    ...ANSWER_COLORS,
  },
  {
    label: '참여집계',
    keys: ['참여율', '참여인원', '미참여인원'],
    ...STAT_COLORS,
  },
];

const SURVEY_HISTORY_LIST_CENTER = new Set<SurveyHistoryListHeader>([
  'NO',
  '식별코드',
  '게시일',
  '유형',
  '익명여부',
  '시작일',
  '종료일',
  '참여율',
  '참여인원',
  '미참여인원',
]);

export async function writeSurveyHistoryListExcelBuffer(
  rows: Array<Record<SurveyHistoryListHeader, string | number>>
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: '설문이력대장',
    headers: SURVEY_HISTORY_LIST_HEADERS,
    groups: SURVEY_HISTORY_LIST_GROUPS,
    rows,
    centerKeys: SURVEY_HISTORY_LIST_CENTER,
  });
}

/** 배달 보관함 화면 목록 — 결과엑셀과 같은 그룹행·3톤 (보관상태 제외) */
export const DELIVERY_HISTORY_LIST_HEADERS = [
  'NO',
  '공고식별코드',
  '게시일',
  '게시명',
  '신청분류',
  '대상 범위',
  '시작일',
  '종료일',
  '최종접수율',
  '접수완료인원',
  '미접수인원',
] as const;

export type DeliveryHistoryListHeader = (typeof DELIVERY_HISTORY_LIST_HEADERS)[number];

const DELIVERY_HISTORY_LIST_GROUPS: OrderExcelGroup<DeliveryHistoryListHeader>[] = [
  {
    label: '공고정보',
    keys: ['공고식별코드', '게시일', '게시명', '신청분류', '대상 범위'],
    ...SUBMIT_COLORS,
  },
  {
    label: '기간',
    keys: ['시작일', '종료일'],
    ...ANSWER_COLORS,
  },
  {
    label: '접수집계',
    keys: ['최종접수율', '접수완료인원', '미접수인원'],
    ...STAT_COLORS,
  },
];

const DELIVERY_HISTORY_LIST_CENTER = new Set<DeliveryHistoryListHeader>([
  'NO',
  '공고식별코드',
  '게시일',
  '신청분류',
  '시작일',
  '종료일',
  '최종접수율',
  '접수완료인원',
  '미접수인원',
]);

export async function writeDeliveryHistoryListExcelBuffer(
  rows: Array<Record<DeliveryHistoryListHeader, string | number>>
): Promise<ArrayBuffer> {
  return writeGroupedOrderExcelBuffer({
    sheetName: '배달아카이브대장',
    headers: DELIVERY_HISTORY_LIST_HEADERS,
    groups: DELIVERY_HISTORY_LIST_GROUPS,
    rows,
    centerKeys: DELIVERY_HISTORY_LIST_CENTER,
  });
}
