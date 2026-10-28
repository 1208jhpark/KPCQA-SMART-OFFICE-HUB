/** 사무문구 묶음 발주파일 — PDF 합본 / 엑셀 탭 취합 */

import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import {
  getOfficeQuoteLinesFromOptions,
  getSuppliesQuoteAttachment,
  type OfficeQuoteLine,
  type SuppliesQuoteAttachment,
} from '@/lib/production-office-statement-match';

export type OfficeOrderFileSource = {
  postNumber?: string;
  userName?: string;
  deptName?: string;
  title?: string;
  options?: unknown;
};

type LoadedFile = {
  label: string;
  userName: string;
  fileName: string;
  bytes: ArrayBuffer;
  kind: 'pdf' | 'excel';
  quoteLines: OfficeQuoteLine[];
};

const NAME_HEADER_KEYS = ['품명', '품목', '제품명'];
const QTY_HEADER_KEYS = ['수량'];
const FOOTER_ROW = /배송료|결제금액|공급가액|총합계|총액|^합계$/;

const AGG_COLUMNS = [
  { key: 'applicant', label: '신청자' },
  { key: 'no', label: '번호' },
  { key: 'code', label: '코드' },
  { key: 'name', label: '제품명' },
  { key: 'price', label: '단가(원)' },
  { key: 'qty', label: '수량' },
  { key: 'sum', label: '합계(원)' },
] as const;

type AggKey = (typeof AGG_COLUMNS)[number]['key'];

function extOf(name: string, mime?: string) {
  const fromName = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (fromName) return fromName;
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('spreadsheet') || m.includes('excel')) return 'xlsx';
  return '';
}

function kindOf(att: SuppliesQuoteAttachment): 'pdf' | 'excel' | 'other' {
  const ext = extOf(att.fileName || att.storedFileName || att.url, att.mimeType);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm' || ext === 'csv') return 'excel';
  return 'other';
}

function excelSheetName(raw: string, used: Set<string>) {
  let name = String(raw || '')
    .replace(/[:\\/?*[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) name = '시트';
  name = name.slice(0, 31);
  let out = name;
  let n = 2;
  while (used.has(out)) {
    const suffix = `(${n})`;
    out = `${name.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(out);
  return out;
}

function applicantName(item: OfficeOrderFileSource) {
  return String(item.userName || '').trim() || String(item.postNumber || '').trim() || '신청자';
}

function departmentName(items: Array<{ deptName?: string }>) {
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

function deptTabName(dept: string, kind: '발주서') {
  const suffix = `(${kind})`;
  const base = String(dept || '').trim() || '부서';
  return `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
}

const FREE_SHIPPING_MIN = 50000;
const SHIPPING_FEE = 3000;

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(
    String(v ?? '')
      .replace(/,/g, '')
      .replace(/원/g, '')
      .trim()
  );
  return Number.isFinite(n) ? n : 0;
}

type QuoteItem = {
  code: string;
  name: string;
  price: number;
  qty: number;
  sum: number;
};

function collectQuoteItems(files: LoadedFile[]): QuoteItem[] {
  const items: QuoteItem[] = [];
  for (const file of files) {
    const rows = rowsFromExcelFile(file);
    if (rows.length > 0) {
      for (const row of rows) {
        const price = toNumber(row[4]);
        const qty = toNumber(row[5]);
        const sum = toNumber(row[6]) || price * qty;
        items.push({
          code: String(row[2] ?? '').trim(),
          name: String(row[3] ?? '').trim(),
          price,
          qty,
          sum,
        });
      }
      continue;
    }
    for (const line of file.quoteLines) {
      items.push({
        code: String(line.code || '').trim(),
        name: line.productName,
        price: line.unitPrice,
        qty: line.qty,
        sum: line.supplyPrice || line.unitPrice * line.qty,
      });
    }
  }
  return items.filter((it) => it.qty > 0 || it.sum > 0);
}

/** 코드 + 단가가 같으면 수량·합계를 한 줄로 */
function mergeQuoteItems(items: QuoteItem[]): QuoteItem[] {
  const map = new Map<string, QuoteItem>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.code
      ? `${compactText(it.code)}|${it.price}`
      : `n:${compactText(it.name)}|${it.price}`;
    const prev = map.get(key);
    if (prev) {
      prev.qty += it.qty;
      prev.sum += it.sum;
    } else {
      map.set(key, { ...it });
      order.push(key);
    }
  }
  return order.map((k) => map.get(k)!);
}

function setSheetCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (typeof value === 'number') {
    ws[addr] = { t: 'n', v: value, z: '#,##0' };
  } else {
    ws[addr] = { t: 's', v: value };
  }
}

function clearSheetCell(ws: XLSX.WorkSheet, r: number, c: number) {
  delete ws[XLSX.utils.encode_cell({ r, c })];
}

function shiftSheetRows(ws: XLSX.WorkSheet, at: number, count: number) {
  if (count <= 0) return;
  const moved: Array<[string, XLSX.CellObject]> = [];
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const addr = XLSX.utils.decode_cell(key);
    if (addr.r >= at) {
      moved.push([key, ws[key] as XLSX.CellObject]);
      delete ws[key];
    }
  }
  for (const [key, cell] of moved) {
    const addr = XLSX.utils.decode_cell(key);
    addr.r += count;
    ws[XLSX.utils.encode_cell(addr)] = cell;
  }
  if (ws['!merges']) {
    ws['!merges'] = ws['!merges'].map((m) => {
      const s = { r: m.s.r, c: m.s.c };
      const e = { r: m.e.r, c: m.e.c };
      if (s.r >= at) s.r += count;
      if (e.r >= at) e.r += count;
      return { s, e };
    });
  }
  if (ws['!rows']) {
    const next: XLSX.RowInfo[] = [];
    ws['!rows'].forEach((row, i) => {
      next[i >= at ? i + count : i] = row;
    });
    ws['!rows'] = next;
  }
  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r >= at) range.e.r += count;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
}

function fillDeptOrderQuoteSheet(ws: XLSX.WorkSheet, items: QuoteItem[]) {
  const aoa = sheetToAoa(ws);
  const headerIdx = findHeaderRowIndex(aoa);
  if (headerIdx < 0) return;
  const headerRow = Array.isArray(aoa[headerIdx]) ? aoa[headerIdx] : [];
  const colOf: Partial<Record<AggKey, number>> = {};
  headerRow.forEach((h, i) => {
    const key = mapHeaderKey(h);
    if (key && colOf[key] == null) colOf[key] = i;
  });
  let shipIdx = -1;
  let payIdx = -1;
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const text = compactText((aoa[r] || []).join(''));
    if (shipIdx < 0 && text.includes('배송료')) shipIdx = r;
    if (payIdx < 0 && text.includes('결제금액')) payIdx = r;
  }
  const footerIdx = shipIdx >= 0 ? shipIdx : payIdx;
  if (footerIdx < 0) return;

  const productStart = headerIdx + 1;
  let slots = footerIdx - productStart;
  if (items.length > slots) {
    const extra = items.length - slots;
    shiftSheetRows(ws, footerIdx, extra);
    if (shipIdx >= 0) shipIdx += extra;
    if (payIdx >= 0) payIdx += extra;
    slots = items.length;
  }

  const dataKeys: AggKey[] = ['no', 'code', 'name', 'price', 'qty', 'sum'];
  for (let i = 0; i < slots; i++) {
    for (const key of dataKeys) {
      const c = colOf[key];
      if (c == null) continue;
      clearSheetCell(ws, productStart + i, c);
    }
  }
  items.forEach((it, i) => {
    const r = productStart + i;
    if (colOf.no != null) setSheetCell(ws, r, colOf.no, i + 1);
    if (colOf.code != null) setSheetCell(ws, r, colOf.code, it.code);
    if (colOf.name != null) setSheetCell(ws, r, colOf.name, it.name);
    if (colOf.price != null) setSheetCell(ws, r, colOf.price, it.price);
    if (colOf.qty != null) setSheetCell(ws, r, colOf.qty, it.qty);
    if (colOf.sum != null) setSheetCell(ws, r, colOf.sum, it.sum);
  });

  const productTotal = items.reduce((s, it) => s + it.sum, 0);
  const shipping = productTotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
  if (shipIdx >= 0 && colOf.sum != null) setSheetCell(ws, shipIdx, colOf.sum, shipping);
  if (payIdx >= 0 && colOf.sum != null) {
    setSheetCell(ws, payIdx, colOf.sum, productTotal + shipping);
  }
}

function buildDeptOrderSheet(files: LoadedFile[], items: QuoteItem[]): XLSX.WorkSheet | null {
  if (items.length === 0) return null;
  for (const file of files) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(file.bytes, {
        type: 'array',
        cellNF: true,
        cellStyles: true,
        cellDates: false,
      });
    } catch {
      continue;
    }
    const src = pickQuoteSheet(wb);
    if (!src || findHeaderRowIndex(sheetToAoa(src)) < 0) continue;
    const ws = JSON.parse(JSON.stringify(src)) as XLSX.WorkSheet;
    fillDeptOrderQuoteSheet(ws, items);
    return ws;
  }
  return null;
}

function asOptions(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function compactText(v: unknown) {
  return String(v ?? '').replace(/\s+/g, '');
}

function cellText(v: unknown) {
  return String(v ?? '')
    .replace(/\s+/g, '')
    .trim();
}

function rowHasAny(row: unknown[], keys: string[]) {
  const cells = row.map(cellText);
  return keys.some((k) => cells.some((c) => c.includes(k)));
}

function findHeaderRowIndex(aoa: unknown[][]) {
  const max = Math.min(aoa.length, 40);
  for (let i = 0; i < max; i++) {
    const row = Array.isArray(aoa[i]) ? aoa[i] : [];
    if (rowHasAny(row, NAME_HEADER_KEYS) && rowHasAny(row, QTY_HEADER_KEYS)) return i;
  }
  return -1;
}

function isFooterRow(row: unknown[]) {
  const filled = row.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (filled.length === 0) return false;
  const text = compactText(filled.join(''));
  return FOOTER_ROW.test(text);
}

function mapHeaderKey(h: unknown): Exclude<AggKey, 'applicant'> | null {
  const t = compactText(h);
  if (!t || /사업자/.test(t)) return null;
  if (t.includes('번호')) return 'no';
  if (t.includes('코드')) return 'code';
  if (t.includes('제품명') || t.includes('품명') || t.includes('품목')) return 'name';
  if (t.includes('단가')) return 'price';
  if (t.includes('수량')) return 'qty';
  if (t.includes('합계') || t === '금액') return 'sum';
  return null;
}

function isProductRow(row: unknown[], colOf: Partial<Record<AggKey, number>>) {
  const no = colOf.no != null ? row[colOf.no] : undefined;
  const name = colOf.name != null ? row[colOf.name] : undefined;
  const qty = colOf.qty != null ? row[colOf.qty] : undefined;
  const noText = String(no ?? '').trim();
  const nameText = String(name ?? '').trim();
  const qtyNum = Number(String(qty ?? '').replace(/,/g, ''));
  if (isFooterRow(row)) return false;
  if (/^\d+$/.test(noText) && nameText) return true;
  if (nameText && Number.isFinite(qtyNum) && qtyNum > 0) return true;
  return false;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function fetchAttachmentBytes(att: SuppliesQuoteAttachment): Promise<ArrayBuffer> {
  const res = await fetch(att.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${att.fileName} 파일을 가져오지 못했습니다.`);
  return res.arrayBuffer();
}

async function loadBatchFiles(items: OfficeOrderFileSource[]): Promise<{
  files: LoadedFile[];
  missing: number;
  other: number;
}> {
  const files: LoadedFile[] = [];
  let missing = 0;
  let other = 0;
  for (const item of items) {
    const att = getSuppliesQuoteAttachment(item.options);
    if (!att) {
      missing += 1;
      continue;
    }
    const kind = kindOf(att);
    if (kind === 'other') {
      other += 1;
      continue;
    }
    try {
      const bytes = await fetchAttachmentBytes(att);
      const userName = applicantName(item);
      files.push({
        label: userName,
        userName,
        fileName: att.fileName,
        bytes,
        kind,
        quoteLines: getOfficeQuoteLinesFromOptions(asOptions(item.options)).filter(
          (line) => !FOOTER_ROW.test(compactText(line.productName))
        ),
      });
    } catch {
      missing += 1;
    }
  }
  return { files, missing, other };
}

async function mergePdfs(files: LoadedFile[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  let copied = 0;
  for (const file of files) {
    try {
      const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      copied += pages.length;
    } catch {
      /* skip unreadable pdf */
    }
  }
  if (copied === 0) {
    throw new Error('합본할 PDF 페이지를 읽지 못했습니다.');
  }
  return out.save();
}

function sheetToAoa(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
  });
}

function isPlaceholderSheet(ws: XLSX.WorkSheet): boolean {
  const aoa = sheetToAoa(ws);
  if (findHeaderRowIndex(aoa) >= 0) return false;
  const head = compactText(aoa.slice(0, 6).flat().join(''));
  if (head.includes('견적서') || head.includes('거래명세서')) return false;
  const filled = aoa.flat().filter((c) => String(c ?? '').trim());
  return filled.length <= 2;
}

/** 파일당 견적 본문 시트 1장만 (엑셀 기본 Sheet2/Sheet3 제외) */
function pickQuoteSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  const content = wb.SheetNames.map((name) => wb.Sheets[name]).filter(
    (ws): ws is XLSX.WorkSheet => Boolean(ws) && !isPlaceholderSheet(ws)
  );
  if (content.length === 0) return wb.Sheets[wb.SheetNames[0]] || null;
  const withHeader = content.find((ws) => findHeaderRowIndex(sheetToAoa(ws)) >= 0);
  return withHeader || content[0];
}

function rowsFromExcelFile(file: LoadedFile): unknown[][] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(file.bytes, { type: 'array', cellDates: true });
  } catch {
    return [];
  }
  const ws = pickQuoteSheet(wb);
  if (!ws) return [];
  const aoa = sheetToAoa(ws);
  const headerIdx = findHeaderRowIndex(aoa);
  if (headerIdx < 0) return [];
  const headerRow = Array.isArray(aoa[headerIdx]) ? aoa[headerIdx] : [];
  const colOf: Partial<Record<AggKey, number>> = {};
  headerRow.forEach((h, i) => {
    const key = mapHeaderKey(h);
    if (key && colOf[key] == null) colOf[key] = i;
  });
  const rows: unknown[][] = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : [];
    if (isFooterRow(row)) break;
    if (!isProductRow(row, colOf)) continue;
    const pick = (key: AggKey) => {
      const idx = colOf[key];
      return idx == null ? '' : row[idx] ?? '';
    };
    rows.push([
      file.userName,
      pick('no'),
      pick('code'),
      pick('name'),
      pick('price'),
      pick('qty'),
      pick('sum'),
    ]);
  }
  return rows;
}

function buildAggregateSheet(excelFiles: LoadedFile[]): XLSX.WorkSheet | null {
  const dataRows: unknown[][] = [];
  for (const file of excelFiles) {
    const fromFile = rowsFromExcelFile(file);
    if (fromFile.length > 0) {
      dataRows.push(...fromFile);
      continue;
    }
    for (const line of file.quoteLines) {
      dataRows.push([
        file.userName,
        line.lineNo,
        line.code,
        line.productName,
        line.unitPrice,
        line.qty,
        line.supplyPrice,
      ]);
    }
  }
  if (dataRows.length === 0) return null;
  return XLSX.utils.aoa_to_sheet([AGG_COLUMNS.map((c) => c.label), ...dataRows]);
}

type ExcelWorkbook = import('exceljs').Workbook;
type ExcelWorksheet = import('exceljs').Worksheet;

const THIN_BORDER = {
  style: 'thin' as const,
  color: { argb: 'FF000000' },
};
const GRID_BORDER = {
  top: THIN_BORDER,
  left: THIN_BORDER,
  bottom: THIN_BORDER,
  right: THIN_BORDER,
};

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function rgbToArgb(rgb: unknown): string | null {
  const raw = String(rgb || '')
    .replace(/^#/, '')
    .toUpperCase();
  if (/^[0-9A-F]{6}$/.test(raw)) return `FF${raw}`;
  if (/^[0-9A-F]{8}$/.test(raw)) return raw;
  return null;
}

function cellDisplayValue(cell: XLSX.CellObject): import('exceljs').CellValue {
  const formula = typeof cell.f === 'string' ? cell.f : '';
  if (cell.t === 'e' || /#REF!/i.test(formula)) {
    return cell.w || String(cell.v ?? '');
  }
  if (cell.t === 'b') return Boolean(cell.v);
  if (cell.t === 'n') return typeof cell.v === 'number' ? cell.v : Number(cell.v);
  if (cell.v == null) return '';
  return cell.v as import('exceljs').CellValue;
}

function applySafePageSetup(ws: ExcelWorksheet) {
  ws.pageSetup.orientation = 'portrait';
  ws.pageSetup.horizontalDpi = 72;
  ws.pageSetup.verticalDpi = 72;
  ws.pageSetup.fitToPage = false;
  ws.pageSetup.paperSize = 9;
}

function findMergeAt(merges: XLSX.Range[], r: number, c: number): XLSX.Range | undefined {
  return merges.find(
    (m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c
  );
}

function hasMerge(merges: XLSX.Range[], r: number, c0: number, c1: number) {
  return merges.some((m) => m.s.r === r && m.e.r === r && m.s.c === c0 && m.e.c === c1);
}

/** 견적서 템플릿은 제품명 1행만 병합. 2행부터 빈칸에 세로선을 그리면 글이 잘리므로 같은 병합을 이어 줌 */
function withProductNameMerges(src: XLSX.WorkSheet): XLSX.Range[] {
  const merges: XLSX.Range[] = (src['!merges'] || []).map((m) => ({
    s: { r: m.s.r, c: m.s.c },
    e: { r: m.e.r, c: m.e.c },
  }));
  const aoa = sheetToAoa(src);
  const headerIdx = findHeaderRowIndex(aoa);
  if (headerIdx < 0) return merges;
  const headerRow = Array.isArray(aoa[headerIdx]) ? aoa[headerIdx] : [];
  const colOf: Partial<Record<AggKey, number>> = {};
  let nameCol = -1;
  headerRow.forEach((h, i) => {
    const key = mapHeaderKey(h);
    if (key && colOf[key] == null) colOf[key] = i;
    if (key === 'name') nameCol = i;
  });
  if (nameCol < 0) return merges;
  const headerMerge = findMergeAt(merges, headerIdx, nameCol);
  if (!headerMerge) return merges;
  const c0 = headerMerge.s.c;
  const c1 = headerMerge.e.c;
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : [];
    if (isFooterRow(row)) break;
    if (!isProductRow(row, colOf)) continue;
    if (!hasMerge(merges, r, c0, c1)) {
      merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });
    }
  }
  return merges;
}

function outerBorder(r: number, c: number, m: XLSX.Range) {
  const border: Partial<Record<'top' | 'bottom' | 'left' | 'right', typeof THIN_BORDER>> = {};
  if (r === m.s.r) border.top = THIN_BORDER;
  if (r === m.e.r) border.bottom = THIN_BORDER;
  if (c === m.s.c) border.left = THIN_BORDER;
  if (c === m.e.c) border.right = THIN_BORDER;
  return border;
}

function paintOriginalSheet(dest: ExcelWorkbook, src: XLSX.WorkSheet, name: string) {
  const destWs: ExcelWorksheet = dest.addWorksheet(name);
  applySafePageSetup(destWs);
  const merges = withProductNameMerges(src);

  (src['!cols'] || []).forEach((col, i) => {
    if (!col) return;
    const width = col.wch != null ? col.wch : col.width;
    if (width != null) destWs.getColumn(i + 1).width = width;
    if (col.hidden) destWs.getColumn(i + 1).hidden = true;
  });
  (src['!rows'] || []).forEach((row, i) => {
    if (!row) return;
    const dRow = destWs.getRow(i + 1);
    if (row.hpt != null) dRow.height = row.hpt;
    else if (row.hpx != null) dRow.height = row.hpx;
    if (row.hidden) dRow.hidden = true;
  });

  let lastR = 0;
  let lastC = 0;
  for (const m of merges) {
    lastR = Math.max(lastR, m.e.r);
    lastC = Math.max(lastC, m.e.c);
  }

  for (const key of Object.keys(src)) {
    if (key.startsWith('!')) continue;
    const cell = src[key] as XLSX.CellObject | undefined;
    if (!cell || cell.t === 'z') continue;
    const addr = XLSX.utils.decode_cell(key);
    lastR = Math.max(lastR, addr.r);
    lastC = Math.max(lastC, addr.c);
    const dCell = destWs.getCell(addr.r + 1, addr.c + 1);
    dCell.value = cellDisplayValue(cell);
    if (cell.z && cell.z !== 'General') dCell.numFmt = cell.z;
    const fillRgb = rgbToArgb((cell.s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb);
    const pattern = (cell.s as { patternType?: string } | undefined)?.patternType;
    if (fillRgb && pattern === 'solid') {
      dCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: fillRgb },
      };
    }
    const text = compactText(cell.w || cell.v || '');
    if (text === '거래명세서' || text === '견적서') {
      dCell.font = { name: '맑은 고딕', size: 16, underline: true };
      dCell.alignment = { horizontal: 'center', vertical: 'middle' };
    } else {
      dCell.alignment = {
        vertical: 'middle',
        wrapText: false,
        horizontal: typeof cell.v === 'number' ? 'right' : 'left',
      };
    }
  }

  for (const m of merges) {
    try {
      destWs.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
    } catch {
      /* skip overlapping */
    }
  }

  const headerIdx = findHeaderRowIndex(sheetToAoa(src));
  for (let r = 0; r <= lastR; r++) {
    for (let c = 0; c <= lastC; c++) {
      const m = findMergeAt(merges, r, c);
      if (m) {
        destWs.getCell(r + 1, c + 1).border = outerBorder(r, c, m);
      } else if (headerIdx >= 0 && r >= headerIdx) {
        destWs.getCell(r + 1, c + 1).border = GRID_BORDER;
      }
    }
  }
}

function addAggregateSheet(
  dest: ExcelWorkbook,
  agg: XLSX.WorkSheet,
  name: string
) {
  const ws = dest.addWorksheet(name);
  applySafePageSetup(ws);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(agg, {
    header: 1,
    raw: true,
    defval: '',
  });
  const moneyCols = new Set([5, 7]);
  aoa.forEach((row, r) => {
    (row || []).forEach((v, c) => {
      const cell = ws.getCell(r + 1, c + 1);
      cell.value = (v ?? '') as import('exceljs').CellValue;
      if (r === 0) cell.font = { bold: true };
      else if (moneyCols.has(c + 1) && typeof v === 'number') cell.numFmt = '#,##0';
    });
  });
  const widths = [14, 8, 12, 42, 12, 8, 12];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

/** 1번째 부서(발주서) · 2번째 인원별 취합 · 이후 신청자 원본 */
async function mergeExcels(
  files: LoadedFile[],
  deptName: string
): Promise<{ buffer: ArrayBuffer; aggregated: boolean }> {
  const ExcelJS = (await import('exceljs')).default;
  const dest = new ExcelJS.Workbook();
  dest.creator = 'KPCQA WISE';
  const used = new Set<string>();

  const mergedItems = mergeQuoteItems(collectQuoteItems(files));
  const orderWs = buildDeptOrderSheet(files, mergedItems);
  if (orderWs) {
    paintOriginalSheet(dest, orderWs, excelSheetName(deptTabName(deptName, '발주서'), used));
  }

  const agg = buildAggregateSheet(files);
  if (agg) addAggregateSheet(dest, agg, excelSheetName('인원별 취합', used));

  for (const file of files) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(file.bytes, {
        type: 'array',
        cellNF: true,
        cellStyles: true,
        cellDates: false,
      });
    } catch {
      continue;
    }
    const ws = pickQuoteSheet(wb);
    if (!ws) continue;
    paintOriginalSheet(dest, ws, excelSheetName(file.userName, used));
  }

  if (dest.worksheets.length === 0) {
    throw new Error('취합할 엑셀 시트를 읽지 못했습니다.');
  }
  const written = (await dest.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  return {
    buffer: toArrayBuffer(written),
    aggregated: dest.worksheets.some((w) => w.name === '인원별 취합'),
  };
}

export type OfficeOrderBundleResult = {
  pdfCount: number;
  excelCount: number;
  aggregated: boolean;
  warnings: string[];
};

/** 묶음 내 드림디포 첨부를 PDF 합본 / 엑셀(취합+이름탭)로 내려받음 */
export async function downloadOfficeOrderFileBundle(
  items: OfficeOrderFileSource[],
  baseName: string
): Promise<OfficeOrderBundleResult> {
  const { files, missing, other } = await loadBatchFiles(items);
  const warnings: string[] = [];
  if (missing > 0) warnings.push(`첨부 없음·불러오기 실패 ${missing}건`);
  if (other > 0) warnings.push(`PDF/엑셀이 아닌 첨부 ${other}건은 제외`);

  const pdfs = files.filter((f) => f.kind === 'pdf');
  const excels = files.filter((f) => f.kind === 'excel');

  if (pdfs.length === 0 && excels.length === 0) {
    throw new Error(
      warnings.length
        ? `내려받을 PDF/엑셀 첨부가 없습니다. (${warnings.join(', ')})`
        : '신청 시 첨부된 드림디포 견적서가 없습니다.'
    );
  }

  if (pdfs.length > 0) {
    const bytes = await mergePdfs(pdfs);
    triggerBlobDownload(
      new Blob([bytes], { type: 'application/pdf' }),
      `${baseName}_합본.pdf`
    );
  }

  let aggregated = false;
  if (excels.length > 0) {
    const merged = await mergeExcels(excels, departmentName(items));
    aggregated = merged.aggregated;
    triggerBlobDownload(
      new Blob([new Uint8Array(merged.buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${baseName}_취합.xlsx`
    );
  }

  return { pdfCount: pdfs.length, excelCount: excels.length, aggregated, warnings };
}
