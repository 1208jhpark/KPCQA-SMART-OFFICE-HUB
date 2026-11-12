/** 법인카드 마스터 반납이력 — 사용관리 대장 양식 */

export const CORP_CARD_HISTORY_HEADERS = [
  '카드번호',
  '사용자',
  '사용처, 사용목적',
  '수령 일자',
  '반납 예정일',
  '사용금액',
  '회수 일자',
  '사용자 확인',
  '반출 담당자',
  '반납 담당자',
] as const;

export type CorpCardHistoryHeader = (typeof CORP_CARD_HISTORY_HEADERS)[number];

export type CorpCardHistoryExcelRow = Record<CorpCardHistoryHeader, string | number>;

const CENTER_KEYS = new Set<CorpCardHistoryHeader>([
  '카드번호',
  '수령 일자',
  '반납 예정일',
  '사용금액',
  '회수 일자',
  '사용자 확인',
  '반출 담당자',
  '반납 담당자',
]);

const COL_WIDTHS: Record<CorpCardHistoryHeader, number> = {
  카드번호: 12,
  사용자: 14,
  '사용처, 사용목적': 28,
  '수령 일자': 16,
  '반납 예정일': 16,
  사용금액: 12,
  '회수 일자': 16,
  '사용자 확인': 14,
  '반출 담당자': 14,
  '반납 담당자': 14,
};

function dash(v: unknown) {
  const s = String(v ?? '').trim();
  return s || '-';
}

/** 조회 연·월 → `2026년 법인카드(고객마케팅, 부서운영비) 사용관리 대장` */
export function buildCorpCardHistoryLedgerTitle(opts?: {
  year?: string | number | null;
  month?: string | number | null;
}) {
  const yearRaw = String(opts?.year ?? '').trim();
  const monthRaw = String(opts?.month ?? '').trim();
  const year =
    yearRaw && yearRaw !== 'ALL' && /^\d{4}$/.test(yearRaw) ? yearRaw : '';
  const monthNum =
    monthRaw && monthRaw !== 'ALL' && /^\d{1,2}$/.test(monthRaw)
      ? String(parseInt(monthRaw, 10))
      : '';
  const period = year
    ? monthNum
      ? `${year}년 ${monthNum}월 `
      : `${year}년 `
    : '';
  return `${period}법인카드(고객마케팅, 부서운영비) 사용관리 대장`;
}

/** 법인카드 마스터 이력 — 대장 제목행 + 이미지 칼럼 구성 */
export async function writeCorpCardMasterHistoryExcelBuffer(
  rows: CorpCardHistoryExcelRow[],
  opts?: { year?: string | number | null; month?: string | number | null; sheetName?: string }
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts?.sheetName || '사용관리대장');
  const headers = CORP_CARD_HISTORY_HEADERS;
  const colCount = headers.length;
  const title = buildCorpCardHistoryLedgerTitle(opts);

  const gridLine = { style: 'thin' as const, color: { argb: 'FF94A3B8' } };
  const gridBorder = { top: gridLine, left: gridLine, bottom: gridLine, right: gridLine };

  const titleRow = sheet.getRow(1);
  titleRow.height = 28;
  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = titleRow.getCell(1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, name: '맑은 고딕', color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  for (let c = 1; c <= colCount; c += 1) {
    titleRow.getCell(c).border = gridBorder;
  }

  const headerRow = sheet.getRow(2);
  headerRow.height = 24;
  headers.forEach((key, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = key;
    cell.font = { bold: true, size: 10, name: '맑은 고딕', color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = gridBorder;
  });

  rows.forEach((row) => {
    const values = headers.map((key) => {
      const v = row[key];
      if (v === undefined || v === null || v === '') return '-';
      return v;
    });
    const excelRow = sheet.addRow(values);
    const lineCount = values.reduce<number>((max, v) => {
      const n = String(v ?? '').split('\n').length;
      return Math.max(max, n);
    }, 1);
    excelRow.height = Math.max(22, lineCount * 16);
    headers.forEach((key, idx) => {
      const cell = excelRow.getCell(idx + 1);
      cell.font = { size: 10, name: '맑은 고딕', color: { argb: 'FF0F172A' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: CENTER_KEYS.has(key) ? 'center' : 'left',
        wrapText: true,
      };
      cell.border = gridBorder;
    });
  });

  headers.forEach((key, idx) => {
    sheet.getColumn(idx + 1).width = COL_WIDTHS[key];
  });

  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 2, topLeftCell: 'A3' }];
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function buildCorpCardHistoryExcelRows(
  items: Array<{
    last4?: string | null;
    userName?: string | null;
    pickupName?: string | null;
    pickupType?: string | null;
    status?: string | null;
    place?: string | null;
    purpose?: string | null;
    checkoutAt?: string | null;
    reservedAt?: string | null;
    expectedReturnAt?: string | null;
    amount?: string | number | null;
    returnedAt?: string | null;
    userConfirmedBy?: string | null;
    returnType?: string | null;
    checkoutConfirmedBy?: string | null;
    managerConfirmedBy?: string | null;
  }>,
  formatters: {
    userLabel: (row: {
      userName?: string | null;
      pickupName?: string | null;
      pickupType?: string | null;
      status?: string | null;
    }) => string;
    returnConfirmLabel: (row: {
      userConfirmedBy?: string | null;
      returnType?: string | null;
    }) => string;
    dateTime: (value?: string | null) => string;
    amount: (value?: string | number | null) => string;
  }
): CorpCardHistoryExcelRow[] {
  return items.map((item) => {
    const place = dash(item.place);
    const purpose = dash(item.purpose);
    const placePurpose =
      place === '-' && purpose === '-'
        ? '-'
        : place === '-'
          ? purpose
          : purpose === '-'
            ? place
            : `${place}\n${purpose}`;
    const amountRaw = item.amount;
    const amountText =
      amountRaw === undefined || amountRaw === null || String(amountRaw).trim() === ''
        ? '-'
        : formatters.amount(amountRaw) || dash(amountRaw);

    return {
      카드번호: dash(item.last4),
      사용자: formatters.userLabel(item) || '-',
      '사용처, 사용목적': placePurpose,
      '수령 일자': formatters.dateTime(item.checkoutAt || item.reservedAt) || '-',
      '반납 예정일': formatters.dateTime(item.expectedReturnAt) || '-',
      사용금액: amountText,
      '회수 일자': formatters.dateTime(item.returnedAt) || '-',
      '사용자 확인': formatters.returnConfirmLabel(item) || '-',
      '반출 담당자': dash(item.checkoutConfirmedBy),
      '반납 담당자': dash(item.managerConfirmedBy),
    };
  });
}
