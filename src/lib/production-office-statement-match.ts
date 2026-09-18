/**
 * 사무문구류(OFFICE_SUPPLIES) 전용 견적서↔거래명세서 매칭
 * — 견적 PDF 붙여넣기 텍스트 vs 드림디포형 멀티시트 거래명세서(.xls)
 */

import {
  extractProductionExcelRows,
  getDefaultRulesForCategory,
  normalizeKo,
  parseStatementRow,
  DEFAULT_PLATE_ITEM_ALIASES_OFFICE,
  type GroupMatchSummary,
  type ItemMatchResult,
  type ParsedStatementRow,
  type ProductionDbItem,
  type ProductionStatementRules,
  type StatementColumnHeaderKeywords,
} from '@/lib/production-statement-match';

export type OfficeQuoteLine = {
  lineNo: number;
  code: string;
  productName: string;
  unitPrice: number;
  qty: number;
  supplyPrice: number;
};

/** 신청 requestId ↔ 견적 줄번호 합성 ID 구분자 */
export const OFFICE_QUOTE_LINE_SEP = '::qline::';

export function makeOfficeQuoteLineId(requestId: string, lineNo: number): string {
  return `${requestId}${OFFICE_QUOTE_LINE_SEP}${lineNo}`;
}

export function parseOfficeQuoteLineId(
  id: string
): { requestId: string; lineNo: number } | null {
  const raw = String(id || '');
  const idx = raw.indexOf(OFFICE_QUOTE_LINE_SEP);
  if (idx < 0) return null;
  const requestId = raw.slice(0, idx);
  const lineNo = parseInt(raw.slice(idx + OFFICE_QUOTE_LINE_SEP.length), 10);
  if (!requestId || !Number.isFinite(lineNo)) return null;
  return { requestId, lineNo };
}

/** 제품명 괄호 안 규격/모델 힌트 */
export function extractOfficeProductSpec(productName: string): string {
  const text = String(productName || '');
  const m = text.match(/[（(]([^）)]+)[）)]/);
  if (!m) return '';
  return String(m[1] || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function parseMoney(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) || 0;
}

/** 견적 줄 → 붙여넣기 호환 텍스트 (원문 동기화용) */
export function serializeOfficeQuoteLinesToRawText(lines: OfficeQuoteLine[]): string {
  const normalized = normalizeOfficeQuoteLines(lines);
  if (normalized.length === 0) return '';
  const body = normalized
    .map((l) => {
      const unit = Number(l.unitPrice || 0).toLocaleString('ko-KR');
      const supply = Number(l.supplyPrice || 0).toLocaleString('ko-KR');
      const code = l.code ? `${l.code} ` : '';
      return `${l.lineNo} ${code}${l.productName} ${unit} ${l.qty} ${supply}`;
    })
    .join('\n');
  const total = normalized.reduce((s, l) => s + (l.supplyPrice || 0), 0);
  return [
    '번호 코드 제품명 단가 (원) 수량 합계 (원)',
    body,
    `결제금액 ${total.toLocaleString('ko-KR')}`,
  ].join('\n');
}

/** 강제수정 저장용: 줄 정규화 + 원문/수령체크 정리 */
export function applyOfficeQuoteLinesToOptions(
  options: Record<string, unknown> | null | undefined,
  linesInput: unknown
): Record<string, unknown> {
  const prev = options && typeof options === 'object' ? { ...options } : {};
  const normalized = normalizeOfficeQuoteLines(linesInput);
  const validNos = new Set(normalized.map((l) => l.lineNo));
  const prevReceived = Array.isArray(prev.suppliesReceivedLineNos)
    ? prev.suppliesReceivedLineNos
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && validNos.has(n))
    : [];

  const original =
    typeof prev.suppliesQuoteRawTextOriginal === 'string' &&
    prev.suppliesQuoteRawTextOriginal.trim()
      ? prev.suppliesQuoteRawTextOriginal
      : typeof prev.suppliesQuoteRawText === 'string'
        ? prev.suppliesQuoteRawText
        : '';

  return {
    ...prev,
    ...(original ? { suppliesQuoteRawTextOriginal: original } : {}),
    suppliesQuoteLines: normalized,
    suppliesQuoteRawText: serializeOfficeQuoteLinesToRawText(normalized),
    suppliesReceivedLineNos: prevReceived,
    suppliesQuoteLinesUpdatedAt: new Date().toISOString(),
  };
}

/** 견적 줄 목록 — 강제수정본(suppliesQuoteLines) 우선, 없으면 붙여넣기 파싱 */
export function getOfficeQuoteLinesFromOptions(
  options: Record<string, unknown> | null | undefined
): OfficeQuoteLine[] {
  const structured = options?.suppliesQuoteLines;
  if (Array.isArray(structured) && structured.length > 0) {
    return normalizeOfficeQuoteLines(structured);
  }
  return parseOfficeSuppliesQuoteText(String(options?.suppliesQuoteRawText || ''));
}

export function normalizeOfficeQuoteLines(raw: unknown): OfficeQuoteLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OfficeQuoteLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const productName = String(r.productName || r.name || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!productName) continue;
    const qty = Math.max(1, parseMoney(r.qty) || parseMoney(r.quantity) || 1);
    let unitPrice = parseMoney(r.unitPrice);
    let supplyPrice = parseMoney(r.supplyPrice);
    if (supplyPrice <= 0 && unitPrice > 0) supplyPrice = unitPrice * qty;
    if (unitPrice <= 0 && supplyPrice > 0) unitPrice = Math.round(supplyPrice / qty);
    out.push({
      lineNo: out.length + 1,
      code: String(r.code || '').trim(),
      productName,
      unitPrice,
      qty,
      supplyPrice,
    });
  }
  return out;
}

export type OfficeSheetWorkbook = {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
};

/** 심한 축약명 → 견적서에 나오는 핵심어 (기본값 = 명세표 규칙 기본과 동일) */
export const DEFAULT_OFFICE_PRODUCT_ALIASES: Record<string, string[]> = {
  ...DEFAULT_PLATE_ITEM_ALIASES_OFFICE,
};

/** 현판 등 타 카테고리 키워드가 섞인 저장본 제거 */
export function sanitizeOfficeProductAliases(
  map: Record<string, string[]> | null | undefined
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [rawKey, aliases] of Object.entries(map || {})) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    if (/현판|주물현판|스텐현판|신주현판|텅스텐|명판/.test(key)) continue;
    out[key] = (aliases || []).map((a) => String(a || '').trim()).filter(Boolean);
  }
  return out;
}

/** 기본 별칭 + UI 저장 규칙 병합 (규칙만 보지 않고 기본 퍼지 매칭과 함께 사용) */
export function mergeOfficeProductAliases(
  rulesAliases?: Record<string, string[]> | null
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  const add = (src: Record<string, string[]> | null | undefined) => {
    for (const [k, v] of Object.entries(sanitizeOfficeProductAliases(src))) {
      merged[k] = Array.from(new Set([...(merged[k] || []), ...v]));
    }
  };
  add(DEFAULT_OFFICE_PRODUCT_ALIASES);
  add(rulesAliases);
  return merged;
}

/** 견적 풀네임 → 규칙 UI용 짧은 라벨 */
export function shortenOfficeProductLabel(productName: string): string {
  const cleaned = String(productName || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => normalizeKo(t).length >= 2)
    .slice(0, 3);
  return (tokens.join(' ') || cleaned).slice(0, 48);
}

/** 규칙 UI 목록: 기본 축약키 + 선택 묶음 견적 품명 (+ 저장키) */
export function buildOfficeKeywordMasterLabels(
  quoteProductNames: string[] = [],
  savedKeywords?: Record<string, string[]> | null
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const label = String(raw || '').trim();
    if (!label || seen.has(label)) return;
    if (/현판|주물현판|스텐현판|신주현판|텅스텐|명판/.test(label)) return;
    seen.add(label);
    labels.push(label);
  };
  for (const k of Object.keys(DEFAULT_OFFICE_PRODUCT_ALIASES)) push(k);
  for (const name of quoteProductNames) push(shortenOfficeProductLabel(name));
  for (const k of Object.keys(sanitizeOfficeProductAliases(savedKeywords))) push(k);
  return labels;
}

const OFFICE_HEADER_FALLBACK: StatementColumnHeaderKeywords = {
  certType: ['품명', '품목', '제품명'],
  plateItem: ['품명', '품목', '제품명'],
  spec: ['규격'],
  projectName: [],
  quantity: ['수량'],
  dept: [],
  unitPrice: ['단가'],
  supplyPrice: ['금액', '합계', '합계(원)', '공급가액'],
};

function isSummarySheetName(name: string): boolean {
  const n = normalizeKo(name);
  return n === '합계' || n === '총계' || n === 'summary' || n === 'total' || n.includes('합계표');
}

/** 견적서 붙여넣기 텍스트 → 라인아이템 (발행일~결제금액 구간, 제목행 다음 제품 리스트) */
export function parseOfficeSuppliesQuoteText(raw: string): OfficeQuoteLine[] {
  let text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (!text.trim()) return [];

  // 결제금액 이후(쇼핑몰 푸터 등) 제거
  const payIdx = text.search(/결제\s*금액/);
  if (payIdx >= 0) text = text.slice(0, payIdx);

  // 제목행(번호 코드 제품명…) 이후만 사용
  const headerMatch = text.match(/번호\s*코드\s*제품명[^\n]*/i);
  if (headerMatch && headerMatch.index != null) {
    text = text.slice(headerMatch.index + headerMatch[0].length);
  }

  const rawLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(공급자|공급받는자|사업자|상호|주소|업태|전화|팩스|견\s*적\s*서|발행일)/.test(l));

  // 줄바꿈으로 끊긴 행 병합: "7 5001884" + 제품명 + "1,600 1 1,600"
  const merged: string[] = [];
  for (const line of rawLines) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }
    const prev = merged[merged.length - 1];
    const prevComplete = isCompleteOfficeQuoteLine(prev);
    const startsNew =
      /^\d+\s+\d{4,}/.test(line) || /^\d+\s+\[/.test(line);
    if (!prevComplete && !(startsNew && /^\d+\s+\d{4,}\s+\S+/.test(prev))) {
      merged[merged.length - 1] = `${prev} ${line}`;
      continue;
    }
    // 이전 행이 "N CODE"만 있고 다음이 제품명으로 시작
    if (/^\d+\s+\d{4,}\s*$/.test(prev)) {
      merged[merged.length - 1] = `${prev} ${line}`;
      continue;
    }
    merged.push(line);
  }

  const lines: OfficeQuoteLine[] = [];
  for (const line of merged) {
    if (/결제\s*금액|번호\s*코드\s*제품명/.test(line)) continue;
    const parsed = parseOneOfficeQuoteLine(line);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

function isCompleteOfficeQuoteLine(line: string): boolean {
  return (
    /\d{1,3}(?:,\d{3})+\s+\d+\s+\d{1,3}(?:,\d{3})+\s*$/.test(line) ||
    /\d+\s+\d+\s+\d+\s*$/.test(line)
  );
}

function parseOneOfficeQuoteLine(line: string): OfficeQuoteLine | null {
  // 1 5003420 [미쯔비시] 다색 리필 … 1,000 1 1,000
  let m = line.match(
    /^(\d+)\s+(\d{4,})\s+(.+?)\s+([\d,]+)\s+(\d+)\s+([\d,]+)\s*$/
  );
  if (m) {
    const unitPrice = parseMoney(m[4]);
    const qty = parseMoney(m[5]);
    const supplyPrice = parseMoney(m[6]);
    const productName = String(m[3] || '').replace(/\s+/g, ' ').trim();
    if (!productName || (unitPrice <= 0 && supplyPrice <= 0)) return null;
    return {
      lineNo: parseInt(m[1], 10) || 0,
      code: String(m[2] || '').trim(),
      productName,
      unitPrice,
      qty: qty || 1,
      supplyPrice: supplyPrice || unitPrice * (qty || 1),
    };
  }
  m = line.match(/^(\d+)\s+(.+?)\s+([\d,]+)\s+(\d+)\s+([\d,]+)\s*$/);
  if (!m) return null;
  const unitPrice = parseMoney(m[3]);
  const qty = parseMoney(m[4]);
  const supplyPrice = parseMoney(m[5]);
  const productName = String(m[2] || '').replace(/\s+/g, ' ').trim();
  if (!productName || (unitPrice <= 0 && supplyPrice <= 0)) return null;
  return {
    lineNo: parseInt(m[1], 10) || 0,
    code: '',
    productName,
    unitPrice,
    qty: qty || 1,
    supplyPrice: supplyPrice || unitPrice * (qty || 1),
  };
}

/** 워크북 전 시트(합계 제외)에서 부서별 명세 행 추출 */
export function extractOfficeSuppliesWorkbookRows(
  workbook: OfficeSheetWorkbook,
  sheetToJson: (sheet: unknown) => unknown[][],
  columnHeaders?: StatementColumnHeaderKeywords
): ParsedStatementRow[] {
  const headers = columnHeaders?.plateItem?.length
    ? columnHeaders
    : OFFICE_HEADER_FALLBACK;

  const results: ParsedStatementRow[] = [];
  let rawIndex = 0;

  for (const sheetName of workbook.SheetNames || []) {
    if (isSummarySheetName(sheetName)) continue;
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) continue;

    const json = sheetToJson(sheet);
    const rows = extractProductionExcelRows(json as any[][], headers);
    for (const row of rows) {
      results.push({
        ...row,
        rawIndex: rawIndex++,
        dept: sheetName,
        // 드롭다운/표시용: 부서·품명
        categoryTitle: row.categoryTitle || row.rawItem,
        extractedProjects: row.extractedProjects?.length
          ? row.extractedProjects
          : [row.categoryTitle || row.rawItem],
      });
    }
  }

  return results;
}

function tokenizeProduct(name: string): string[] {
  const cleaned = String(name || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[()（）]/g, ' ')
    .replace(/[/·ㆍ,_-]+/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => normalizeKo(t))
    .filter((t) => t.length >= 2)
    .filter((t) => !/^\d+$/.test(t));
  // 모델번호(653-2, sxnls05 등)도 유지
  const models = String(name || '')
    .match(/[A-Za-z]*\d+[A-Za-z0-9\-]*|\d{2,4}-\d/g)
    ?.map((t) => normalizeKo(t))
    .filter((t) => t.length >= 2) || [];
  return Array.from(new Set([...tokens, ...models]));
}

function aliasBoost(
  quoteName: string,
  stmtName: string,
  aliasesMap: Record<string, string[]> = DEFAULT_OFFICE_PRODUCT_ALIASES
): number {
  const q = normalizeKo(quoteName);
  const s = normalizeKo(stmtName);
  if (!q || !s) return 0;

  for (const [key, aliases] of Object.entries(aliasesMap)) {
    const group = [key, ...(aliases || [])]
      .map((a) => normalizeKo(a))
      .filter((a) => a.length >= 2);
    if (group.length === 0) continue;

    const hits = (text: string) =>
      group.some((kw) => text === kw || text.includes(kw) || kw.includes(text));

    // 견적·명세가 같은 별칭 그룹에 걸리면 축약 매칭으로 본다
    if (hits(q) && hits(s)) return 450;
  }
  return 0;
}

/** 견적 품명 ↔ 명세 축약 품명 점수 (부분 단어·별칭·단가 보조와 함께 사용) */
export function scoreOfficeProductName(
  quoteName: string,
  stmtName: string,
  aliasesMap: Record<string, string[]> = DEFAULT_OFFICE_PRODUCT_ALIASES
): number {
  const q = normalizeKo(quoteName);
  const s = normalizeKo(stmtName);
  if (!q || !s) return 0;
  if (q === s) return 1000;
  if (q.includes(s) || s.includes(q)) return 820 + Math.min(s.length, q.length);

  let score = aliasBoost(quoteName, stmtName, aliasesMap);

  const qTokens = tokenizeProduct(quoteName);
  const sTokens = tokenizeProduct(stmtName);
  if (qTokens.length && sTokens.length) {
    let overlap = 0;
    for (const st of sTokens) {
      if (qTokens.some((qt) => qt === st || qt.includes(st) || st.includes(qt))) {
        overlap += st.length;
      }
    }
    if (overlap > 0) score += 120 + overlap * 25;
  }

  // 최장 공통 부분문자열 (짧은 축약명용)
  const maxLcs = Math.min(s.length, 12);
  let best = 0;
  for (let len = maxLcs; len >= 2; len--) {
    for (let i = 0; i <= s.length - len; i++) {
      const sub = s.slice(i, i + len);
      if (q.includes(sub)) {
        best = len;
        break;
      }
    }
    if (best) break;
  }
  if (best >= 2) score += best * 40;

  return score;
}

function deptSheetScore(sheetName: string, hints: string[]): number {
  const sn = normalizeKo(sheetName);
  if (!sn) return 0;
  let best = 0;
  for (const hint of hints) {
    const h = normalizeKo(hint);
    if (!h) continue;
    if (h === sn) best = Math.max(best, 1000);
    else if (h.includes(sn) || sn.includes(h)) best = Math.max(best, 800);
    else {
      const tokens = tokenizeProduct(hint);
      const hit = tokens.filter((t) => sn.includes(t) || t.includes(sn)).length;
      if (hit) best = Math.max(best, 200 + hit * 80);
    }
  }
  return best;
}

function pickSheetsForItem(
  statementRows: ParsedStatementRow[],
  item: ProductionDbItem,
  quoteText: string
): string[] {
  const sheets = Array.from(
    new Set(statementRows.map((r) => r.dept).filter(Boolean))
  );
  if (sheets.length === 0) return [];

  const hints = [
    item.deptName,
    item.deptHead || '',
    item.title,
    item.projectName,
    quoteText.slice(0, 400),
  ].filter(Boolean);

  const scored = sheets
    .map((s) => ({ sheet: s, score: deptSheetScore(s, hints) }))
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score > 0) {
    const top = scored[0].score;
    return scored.filter((s) => s.score >= top * 0.6 && s.score > 0).map((s) => s.sheet);
  }

  // 힌트가 약하면 전 시트 (단일 신청이면 금액으로 나중에 좁힘)
  return sheets;
}

type LinePair = {
  quoteIdx: number;
  stmtIdx: number;
  score: number;
};

function matchQuoteLinesToStatement(
  quoteLines: OfficeQuoteLine[],
  stmtRows: ParsedStatementRow[],
  aliasesMap: Record<string, string[]> = DEFAULT_OFFICE_PRODUCT_ALIASES
): {
  pairs: Array<{ quote: OfficeQuoteLine; stmt: ParsedStatementRow; score: number }>;
  unmatchedQuotes: OfficeQuoteLine[];
  unmatchedStmts: ParsedStatementRow[];
} {
  const candidates: LinePair[] = [];
  for (let qi = 0; qi < quoteLines.length; qi++) {
    const q = quoteLines[qi];
    for (let si = 0; si < stmtRows.length; si++) {
      const s = stmtRows[si];
      let score = scoreOfficeProductName(
        q.productName,
        s.categoryTitle || s.rawItem,
        aliasesMap
      );
      if (q.unitPrice > 0 && s.unitPrice > 0 && q.unitPrice === s.unitPrice) score += 350;
      if (q.supplyPrice > 0 && s.supplyPrice > 0 && q.supplyPrice === s.supplyPrice) score += 200;
      if (q.qty > 0 && s.qty > 0 && q.qty === s.qty) score += 80;
      // 단가 유일 매칭 보너스
      if (q.unitPrice > 0 && s.unitPrice === q.unitPrice) {
        const samePriceQuotes = quoteLines.filter((x) => x.unitPrice === q.unitPrice).length;
        const samePriceStmts = stmtRows.filter((x) => x.unitPrice === q.unitPrice).length;
        if (samePriceQuotes <= 2 && samePriceStmts === 1) score += 180;
      }
      if (score >= 240) candidates.push({ quoteIdx: qi, stmtIdx: si, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedQuotes = new Set<number>();
  const stmtAssignedQty: Record<number, number> = {};
  const stmtAssignedAmount: Record<number, number> = {};
  const pairs: Array<{ quote: OfficeQuoteLine; stmt: ParsedStatementRow; score: number }> = [];

  for (const c of candidates) {
    if (usedQuotes.has(c.quoteIdx)) continue;
    const q = quoteLines[c.quoteIdx];
    const s = stmtRows[c.stmtIdx];
    const usedQty = stmtAssignedQty[c.stmtIdx] || 0;
    const usedAmt = stmtAssignedAmount[c.stmtIdx] || 0;
    const nextQty = usedQty + (q.qty || 1);
    const nextAmt = usedAmt + (q.supplyPrice || 0);

    // 명세 수량/금액을 넘기면 스킵 (합쳐진 행 허용)
    if (s.qty > 0 && nextQty > s.qty + 0.01) continue;
    if (s.supplyPrice > 0 && nextAmt > s.supplyPrice + 1) continue;

    usedQuotes.add(c.quoteIdx);
    stmtAssignedQty[c.stmtIdx] = nextQty;
    stmtAssignedAmount[c.stmtIdx] = nextAmt;
    pairs.push({ quote: q, stmt: s, score: c.score });
  }

  // 남은 견적: 단가+미배정 수량으로 재시도
  for (let qi = 0; qi < quoteLines.length; qi++) {
    if (usedQuotes.has(qi)) continue;
    const q = quoteLines[qi];
    let best: { si: number; score: number } | null = null;
    for (let si = 0; si < stmtRows.length; si++) {
      const s = stmtRows[si];
      if (q.unitPrice <= 0 || s.unitPrice !== q.unitPrice) continue;
      const usedQty = stmtAssignedQty[si] || 0;
      const usedAmt = stmtAssignedAmount[si] || 0;
      if (s.qty > 0 && usedQty + q.qty > s.qty) continue;
      if (s.supplyPrice > 0 && usedAmt + q.supplyPrice > s.supplyPrice + 1) continue;
      const nameScore = scoreOfficeProductName(
        q.productName,
        s.categoryTitle || s.rawItem,
        aliasesMap
      );
      const score = 300 + nameScore;
      if (!best || score > best.score) best = { si, score };
    }
    if (best && best.score >= 300) {
      const s = stmtRows[best.si];
      usedQuotes.add(qi);
      stmtAssignedQty[best.si] = (stmtAssignedQty[best.si] || 0) + q.qty;
      stmtAssignedAmount[best.si] = (stmtAssignedAmount[best.si] || 0) + q.supplyPrice;
      pairs.push({ quote: q, stmt: s, score: best.score });
    }
  }

  const unmatchedQuotes = quoteLines.filter((_, i) => !usedQuotes.has(i));
  const matchedStmtIdx = new Set(pairs.map((p) => stmtRows.indexOf(p.stmt)));
  // indexOf unstable if duplicate refs — use rawIndex
  const matchedRaw = new Set(pairs.map((p) => p.stmt.rawIndex));
  const unmatchedStmts = stmtRows.filter((s) => !matchedRaw.has(s.rawIndex));

  void matchedStmtIdx;
  return { pairs, unmatchedQuotes, unmatchedStmts };
}

export type OfficeMatchRunResult = {
  itemMatches: ItemMatchResult[];
  groupSummaries: GroupMatchSummary[];
  statementRows: ParsedStatementRow[];
  totalDocPrice: number;
  matchedBatchDocPrice: number;
  totalDbCount: number;
  allMatched: boolean;
  unmatchedRows: ParsedStatementRow[];
  logs: string[];
};

export type OfficeDbItemSource = ProductionDbItem & {
  quoteRawText?: string;
};

/**
 * 사무문구 신청 → 견적 줄 단위로 풀어 거래명세서와 대조
 * — itemMatches.id = `${requestId}::qline::${lineNo}`
 */
export function runOfficeSuppliesStatementMatch(
  dbItems: OfficeDbItemSource[],
  statementRows: ParsedStatementRow[],
  manualOverrides: Record<string, { rowIndex: number; unitPrice?: number }> = {},
  productAliases?: Record<string, string[]> | null
): OfficeMatchRunResult {
  const aliasesMap = mergeOfficeProductAliases(productAliases);
  const logs: string[] = [];
  const itemMatches: ItemMatchResult[] = [];
  const matchedDbIdsByRow: Record<number, string[]> = {};
  statementRows.forEach((r) => {
    matchedDbIdsByRow[r.rawIndex] = [];
  });

  logs.push(
    `📎 사무문구 줄단위 매칭: 명세 ${statementRows.length}행 / 신청 ${dbItems.length}건 (별칭 ${Object.keys(aliasesMap).length}그룹)`
  );

  for (const item of dbItems) {
    const quoteText = String(item.quoteRawText || '').trim();
    const quoteLines = parseOfficeSuppliesQuoteText(quoteText);
    const sheetNames = pickSheetsForItem(statementRows, item, quoteText);
    let scoped = statementRows.filter((r) => sheetNames.includes(r.dept));

    if (quoteLines.length > 0 && sheetNames.length > 1) {
      const quoteTotal = quoteLines.reduce((s, l) => s + (l.supplyPrice || 0), 0);
      const bySheet = sheetNames.map((name) => {
        const rows = statementRows.filter((r) => r.dept === name);
        const total = rows.reduce((s, r) => s + (r.supplyPrice || 0), 0);
        return { name, rows, total, diff: Math.abs(total - quoteTotal) };
      });
      bySheet.sort((a, b) => a.diff - b.diff);
      if (
        bySheet[0] &&
        (quoteTotal <= 0 || bySheet[0].diff <= Math.max(100, quoteTotal * 0.05))
      ) {
        scoped = bySheet[0].rows;
        logs.push(
          `· ${item.postNumber}: 부서탭 [${bySheet[0].name}] (견적합계 ₩${quoteTotal.toLocaleString()})`
        );
      }
    } else if (sheetNames.length === 1) {
      logs.push(`· ${item.postNumber}: 부서탭 [${sheetNames[0]}]`);
    }

    if (quoteLines.length === 0) {
      itemMatches.push({
        ...item,
        id: makeOfficeQuoteLineId(item.id, 0),
        plateLabel: '견적 품목 미파싱',
        plateSize: '',
        title: item.title,
        quantity: 1,
        matchedRowIndex: null,
        matchedRowTitle: '',
        docProjectName: '',
        docUnitPrice: 0,
        nameMatch: false,
        deptMatch: false,
        certMatch: false,
        materialMatch: false,
        matchStatus: 'mismatch',
        adminOverride: false,
        resultNote: '견적서 붙여넣기에서 제품 리스트를 파싱하지 못했습니다',
      });
      continue;
    }

    const { pairs } = matchQuoteLinesToStatement(quoteLines, scoped, aliasesMap);
    const pairByLineNo = new Map(pairs.map((p) => [p.quote.lineNo, p]));

    let matchedLineCount = 0;
    for (const line of quoteLines) {
      const lineId = makeOfficeQuoteLineId(item.id, line.lineNo);
      const spec = extractOfficeProductSpec(line.productName) || line.code;
      const baseItem = {
        ...item,
        id: lineId,
        title: item.title,
        plateLabel: line.productName,
        plateSize: spec,
        projectName: item.title,
        quantity: line.qty || 1,
        certType: line.code || '',
      };

      if (manualOverrides[lineId] !== undefined) {
        const override = manualOverrides[lineId];
        const targetRow = statementRows.find((r) => r.rawIndex === override.rowIndex);
        const unitPrice =
          override.unitPrice ??
          targetRow?.supplyPrice ??
          (targetRow ? targetRow.unitPrice * (targetRow.qty || 1) : line.supplyPrice);
        matchedDbIdsByRow[override.rowIndex]?.push(lineId);
        matchedLineCount += 1;
        itemMatches.push({
          ...baseItem,
          matchedRowIndex: override.rowIndex,
          matchedRowTitle: targetRow
            ? `[${targetRow.dept}] ${targetRow.categoryTitle || targetRow.rawItem}`
            : '수기 지정',
          docProjectName: targetRow?.dept || item.deptName,
          docUnitPrice: unitPrice,
          nameMatch: true,
          deptMatch: true,
          certMatch: true,
          materialMatch: true,
          matchStatus: 'manual',
          adminOverride: true,
          adminPriceSet: override.unitPrice != null,
          resultNote: '관리자 수기 강제 매칭',
        });
        continue;
      }

      // 부모 신청 전체에 대한 수기 오버라이드(구버전) → 줄 합계에 반영
      if (manualOverrides[item.id] !== undefined && !pairByLineNo.has(line.lineNo)) {
        const override = manualOverrides[item.id];
        itemMatches.push({
          ...baseItem,
          matchedRowIndex: override.rowIndex,
          matchedRowTitle: '수기(신청건)',
          docProjectName: item.deptName,
          docUnitPrice: line.supplyPrice,
          nameMatch: true,
          deptMatch: true,
          certMatch: true,
          materialMatch: true,
          matchStatus: 'manual',
          adminOverride: true,
          resultNote: '관리자 수기(신청 단위)',
        });
        matchedLineCount += 1;
        continue;
      }

      const pair = pairByLineNo.get(line.lineNo);
      if (!pair) {
        itemMatches.push({
          ...baseItem,
          matchedRowIndex: null,
          matchedRowTitle: '',
          docProjectName: '',
          docUnitPrice: line.supplyPrice,
          nameMatch: false,
          deptMatch: scoped.length > 0,
          certMatch: false,
          materialMatch: false,
          matchStatus: 'mismatch',
          adminOverride: false,
          resultNote: scoped.length === 0 ? '부서 탭 미검출' : '명세 품목 미매칭',
        });
        continue;
      }

      const stmt = pair.stmt;
      matchedDbIdsByRow[stmt.rawIndex] = matchedDbIdsByRow[stmt.rawIndex] || [];
      if (!matchedDbIdsByRow[stmt.rawIndex].includes(lineId)) {
        matchedDbIdsByRow[stmt.rawIndex].push(lineId);
      }
      matchedLineCount += 1;

      // 줄 금액: 견적 합계(원) — 명세 단가×수량과 다르면 노트에 표시
      const stmtLineAmount =
        stmt.qty === line.qty && stmt.supplyPrice > 0
          ? stmt.supplyPrice
          : stmt.unitPrice > 0
            ? stmt.unitPrice * (line.qty || 1)
            : line.supplyPrice;
      const priceNote =
        stmt.unitPrice > 0 && line.unitPrice > 0 && stmt.unitPrice !== line.unitPrice
          ? `단가차 견적₩${line.unitPrice}/명세₩${stmt.unitPrice}`
          : '';

      itemMatches.push({
        ...baseItem,
        matchedRowIndex: stmt.rawIndex,
        matchedRowTitle: `[${stmt.dept}] ${stmt.categoryTitle || stmt.rawItem}`,
        docProjectName: stmt.dept,
        docUnitPrice: line.supplyPrice || stmtLineAmount,
        nameMatch: true,
        deptMatch: true,
        certMatch: true,
        materialMatch: true,
        matchStatus: 'match',
        adminOverride: false,
        resultNote: priceNote || `코드 ${line.code || '-'}`,
      });
    }

    logs.push(
      `· ${item.postNumber}: 견적 ${matchedLineCount}/${quoteLines.length}줄 매칭 (₩${quoteLines
        .reduce((s, l) => s + l.supplyPrice, 0)
        .toLocaleString()})`
    );
  }

  const groupSummaries: GroupMatchSummary[] = statementRows.map((row) => {
    const dbIds = matchedDbIdsByRow[row.rawIndex] || [];
    const matchedQty = dbIds.reduce((sum, id) => {
      const m = itemMatches.find((x) => x.id === id);
      return sum + (m?.quantity || 0);
    }, 0);
    return {
      rowIndex: row.rawIndex,
      categoryTitle: `[${row.dept}] ${row.categoryTitle || row.rawItem}`,
      isJumul: false,
      spec: row.spec,
      dept: row.dept,
      docQty: row.qty,
      docUnitPrice: row.unitPrice,
      docSupplyPrice: row.supplyPrice,
      matchedDbCount: dbIds.length,
      matchedDbQty: matchedQty,
      isQtyMatched: matchedQty === row.qty || (dbIds.length > 0 && matchedQty > 0),
      isAllItemMatched: dbIds.length > 0,
      dbItemIds: dbIds,
    };
  });

  const totalDocPrice = statementRows.reduce((sum, r) => sum + (r.supplyPrice || 0), 0);
  const matchedBatchDocPrice = itemMatches.reduce(
    (sum, m) =>
      sum +
      (m.matchStatus === 'match' || m.adminOverride ? Number(m.docUnitPrice) || 0 : 0),
    0
  );
  const allMatched =
    itemMatches.length > 0 &&
    itemMatches.every((m) => m.matchStatus === 'match' || m.adminOverride);
  const unmatchedRows = statementRows.filter(
    (r) => (matchedDbIdsByRow[r.rawIndex] || []).length === 0
  );

  return {
    itemMatches,
    groupSummaries,
    statementRows,
    totalDocPrice,
    matchedBatchDocPrice,
    totalDbCount: itemMatches.length,
    allMatched,
    unmatchedRows,
    logs,
  };
}

/** 줄단위 매칭 결과를 신청(request) 단위로 합산 — 검수 저장용 */
export function aggregateOfficeLineMatchesForSave(itemMatches: ItemMatchResult[]): {
  itemStatus: Record<string, string>;
  itemPrice: Record<string, number>;
  parentIds: string[];
} {
  const byParent = new Map<string, ItemMatchResult[]>();
  for (const m of itemMatches) {
    const parsed = parseOfficeQuoteLineId(m.id);
    const parentId = parsed?.requestId || m.id;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(m);
  }
  const itemStatus: Record<string, string> = {};
  const itemPrice: Record<string, number> = {};
  for (const [parentId, lines] of byParent) {
    const ok = lines.every((l) => l.matchStatus === 'match' || l.adminOverride);
    itemStatus[parentId] = ok ? 'match' : 'mismatch';
    itemPrice[parentId] = lines.reduce((s, l) => {
      if (l.matchStatus === 'match' || l.adminOverride) return s + (Number(l.docUnitPrice) || 0);
      return s;
    }, 0);
  }
  return { itemStatus, itemPrice, parentIds: Array.from(byParent.keys()) };
}

/** 엑셀 ArrayBuffer/워크북 + 신청 목록으로 한 번에 실행 */
export function analyzeOfficeSuppliesExcelWorkbook(
  workbook: OfficeSheetWorkbook,
  sheetToJson: (sheet: unknown) => unknown[][],
  dbItems: OfficeDbItemSource[],
  rules?: ProductionStatementRules,
  manualOverrides?: Record<string, { rowIndex: number; unitPrice?: number }>
): OfficeMatchRunResult {
  const headers =
    rules?.columnHeaders ||
    getDefaultRulesForCategory('OFFICE_SUPPLIES').columnHeaders;
  const statementRows = extractOfficeSuppliesWorkbookRows(
    workbook,
    sheetToJson,
    headers
  );
  if (statementRows.length === 0) {
    return {
      itemMatches: [],
      groupSummaries: [],
      statementRows: [],
      totalDocPrice: 0,
      matchedBatchDocPrice: 0,
      totalDbCount: dbItems.length,
      allMatched: false,
      unmatchedRows: [],
      logs: ['❌ 거래명세서 시트에서 품목 행을 찾지 못했습니다. (합계 탭 제외·품명/수량/금액)'],
    };
  }
  return runOfficeSuppliesStatementMatch(
    dbItems,
    statementRows,
    manualOverrides || {},
    rules?.plateItemKeywords
  );
}

/** 테스트/유틸: 단일 시트 2D → ParsedStatementRow (부서명 지정) */
export function extractOfficeSheetRows(
  rows: unknown[][],
  sheetName: string,
  columnHeaders?: StatementColumnHeaderKeywords
): ParsedStatementRow[] {
  const parsed = extractProductionExcelRows(
    rows as any[][],
    columnHeaders || OFFICE_HEADER_FALLBACK
  );
  return parsed.map((row, i) =>
    parseStatementRow(
      row.rawItem,
      row.spec,
      row.qty,
      row.unitPrice,
      row.supplyPrice,
      sheetName,
      i
    )
  );
}
