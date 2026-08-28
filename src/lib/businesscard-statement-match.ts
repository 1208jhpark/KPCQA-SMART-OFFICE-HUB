export type StatementLine = {
  name: string;
  qty: number;
  dept: string;
  price: number;
  item?: string;
};

export type StatementDbItem = {
  id: string;
  name: string;
  dept: string;
  deptHead?: string;
  deptName?: string;
  dbQty: number;
};

export type StatementMatchRow = StatementDbItem & {
  nameMatch: boolean;
  deptMatch: boolean;
  qtyMatch: boolean;
  docQty: number;
  docDept: string;
  docDepts: string[];
  docQtyParts: { dept: string; qty: number }[];
  docPrice: number;
  matchStatus: 'match' | 'mismatch' | 'missing';
  resultNote: string;
  adminOverride?: boolean;
  adminEditedFields?: StatementColKey[];
};

export type StatementColKey = 'name' | 'dept' | 'qty' | 'price';

export type StatementColMap = Record<StatementColKey, string[]>;

export const STATEMENT_COL_FIELDS: { key: StatementColKey; label: string; hint: string }[] = [
  { key: 'name', label: '임직원명', hint: '띄어쓰기는 무시합니다. 문서가 품 목 이어도 품목으로 찾습니다.' },
  { key: 'dept', label: '소속', hint: '띄어쓰기는 무시합니다. 비 고 / 비   고 모두 비고로 찾습니다.' },
  { key: 'qty', label: '신청수량', hint: '띄어쓰기는 무시합니다. 예: 수량, 수 량' },
  { key: 'price', label: '공급가액', hint: '띄어쓰기는 무시합니다. 공 급 가 액 도 공급가액으로 찾습니다.' },
];

export const DEFAULT_STATEMENT_COL_MAP: StatementColMap = {
  name: ['품목'],
  dept: ['비고'],
  qty: ['수량'],
  price: ['공급가액'],
};

export function parseAliasInput(raw: string) {
  return String(raw || '')
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAliasInput(aliases: string[]) {
  return (aliases || []).join(', ');
}

export function normalizeStatementColMap(raw: unknown): StatementColMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const next: StatementColMap = { ...DEFAULT_STATEMENT_COL_MAP };
  (Object.keys(DEFAULT_STATEMENT_COL_MAP) as StatementColKey[]).forEach((key) => {
    const value = src[key];
    if (Array.isArray(value)) {
      const aliases = value.map((v) => String(v || '').trim()).filter(Boolean);
      if (aliases.length) next[key] = aliases;
    } else if (typeof value === 'string') {
      const aliases = parseAliasInput(value);
      if (aliases.length) next[key] = aliases;
    }
  });
  if (next.name.length === 1 && normalizeKo(next.name[0]) === '이름') {
    next.name = ['품목'];
  }
  return next;
}

export function normalizeKo(value: string | null | undefined) {
  return String(value || '')
    .replace(/[\s\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '')
    .replace(/[·ㆍ._\-]/g, '');
}

export function extractNameFromItem(item: string) {
  const names = extractNamesFromItem(item);
  return names[0] || '';
}

export function extractNamesFromItem(item: string) {
  const text = String(item || '');
  const paren = text.match(/명함\s*[\(（]\s*([^)）]+)\s*[\)）]/);
  if (paren?.[1]) {
    const parts = paren[1]
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter((s) => /[가-힣]{2,}/.test(s) || /[A-Za-z]{2,}/.test(s));
    if (parts.length) return parts;
  }
  const fallback = text.replace(/명함/g, '').replace(/[()（）]/g, '').trim();
  return fallback && /[가-힣A-Za-z]{2,}/.test(fallback) ? [fallback] : [];
}

function expandLineByNames(line: StatementLine): StatementLine[] {
  const names = extractNamesFromItem(line.item || line.name || '');
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length <= 1) {
    return [{ ...line, name: unique[0] || line.name }];
  }
  const n = unique.length;
  const qtyEach = line.qty > 0 && line.qty % n === 0
    ? line.qty / n
    : (line.qty >= n ? Math.floor(line.qty / n) : 1);
  const priceEach = line.price > 0 ? Math.round(line.price / n) : 0;
  return unique.map((name) => ({
    ...line,
    name,
    qty: qtyEach,
    price: priceEach,
  }));
}

export function deptMatches(
  docDept: string,
  item: Pick<StatementDbItem, 'dept' | 'deptHead' | 'deptName'>
) {
  const doc = normalizeKo(docDept);
  if (!doc) return false;
  const candidates = [item.deptName, item.deptHead, item.dept]
    .map((v) => normalizeKo(v))
    .filter((v) => v.length >= 2);
  return candidates.some((c) => doc.includes(c) || c.includes(doc));
}

function nameMatches(line: StatementLine, personName: string) {
  const n = normalizeKo(personName);
  if (!n) return false;
  const lineName = normalizeKo(line.name).replace(/\d+$/g, '');
  if (!lineName || lineName.length < 2) return false;
  return lineName === n || lineName.includes(n) || n.includes(lineName);
}

function emptyMatch(item: StatementDbItem): StatementMatchRow {
  return {
    ...item,
    nameMatch: false,
    deptMatch: false,
    qtyMatch: false,
    docQty: 0,
    docDept: '',
    docDepts: [],
    docQtyParts: [],
    docPrice: 0,
    matchStatus: 'missing',
    resultNote: '문서에서 명함+성명 미발견',
  };
}

export function applyStatementMatches(
  dbItems: StatementDbItem[],
  lines: StatementLine[]
): StatementMatchRow[] {
  const used = new Set<number>();
  const nameCount = new Map<string, number>();
  dbItems.forEach((item) => {
    const key = normalizeKo(item.name);
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  });

  return dbItems.map((item) => {
    const hasHomonym = (nameCount.get(normalizeKo(item.name)) || 0) > 1;
    const candidates: number[] = [];
    lines.forEach((line, i) => {
      if (used.has(i) || !nameMatches(line, item.name)) return;
      if (hasHomonym && line.dept && !deptMatches(line.dept, item)) return;
      candidates.push(i);
    });

    if (candidates.length === 0) return emptyMatch(item);

    candidates.forEach((i) => used.add(i));
    const taken = candidates.map((i) => lines[i]);
    const docQtyParts = taken.map((line) => ({
      dept: line.dept || '(소속 미기재)',
      qty: Number(line.qty) || 0,
    }));
    const docDepts = [...new Set(taken.map((line) => line.dept).filter(Boolean))];
    const docQty = taken.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    const docPrice = taken.reduce((sum, line) => sum + (Number(line.price) || 0), 0);
    const nameMatch = true;
    const deptMatch = taken.some((line) => deptMatches(line.dept, item));
    const qtyMatch = docQty === Number(item.dbQty) && docQty > 0;
    const notes: string[] = [];
    if (!deptMatch) {
      notes.push(docDepts.length ? `소속 불일치 (문서: ${docDepts.join(', ')})` : '지정한 소속 열에서 값을 읽지 못했습니다');
    }
    if (!qtyMatch) {
      const parts = docQtyParts.map((p) => `${p.dept} ${p.qty}통`).join(' + ');
      notes.push(docQty ? `수량 불일치 (문서 합계 ${docQty}통${parts ? ` = ${parts}` : ''})` : '수량 미인식');
    }
    if (taken.length > 1 && qtyMatch && deptMatch) {
      notes.length = 0;
    }

    return {
      ...item,
      nameMatch,
      deptMatch,
      qtyMatch,
      docQty,
      docDept: docDepts.join(', '),
      docDepts,
      docQtyParts,
      docPrice,
      matchStatus: nameMatch && deptMatch && qtyMatch ? 'match' : 'mismatch',
      resultNote: nameMatch && deptMatch && qtyMatch
        ? (taken.length > 1
          ? `통과 (이름 일치 · 소속 본부/센터 중 일치 · 수량 합계 ${docQty}통)`
          : '통과 (이름·소속·수량 일치)')
        : notes.join(' · '),
    };
  });
}

function parseNumberCell(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function headerScore(cell: string, alias: string) {
  const compact = normalizeKo(cell);
  const a = normalizeKo(alias);
  if (!compact || a.length < 2) return 0;
  if (compact === a) return 1000 + a.length;
  // 문서 제목 "수량(통)" ← 설정 "수량". 설정값이 더 긴 경우는 같은 열이 아님.
  if (compact.includes(a)) return 500 + a.length;
  return 0;
}

function headerNeedles(colMap?: StatementColMap) {
  const extra = colMap ? Object.values(normalizeStatementColMap(colMap)).flat() : [];
  return [...new Set([...LAYOUT_HEADERS, ...NAME_ANCHOR_HEADERS, ...extra]
    .map((s) => normalizeKo(s))
    .filter((s) => s.length >= 2))]
    .sort((a, b) => b.length - a.length);
}

/** PDF가 '비   고'를 두 칸으로 쪼개도 비고로 붙인다. */
function mergeHeaderFragments(tokens: string[], colMap: StatementColMap) {
  const needles = headerNeedles(colMap);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let taken = 0;
    let text = tokens[i];
    const maxSpan = Math.min(6, tokens.length - i);
    for (let span = maxSpan; span >= 1; span--) {
      const chunk = normalizeKo(tokens.slice(i, i + span).join(''));
      if (needles.includes(chunk)) {
        taken = span;
        text = chunk;
        break;
      }
    }
    if (taken > 1) {
      out.push(text);
      i += taken;
    } else {
      const compact = normalizeKo(tokens[i]);
      out.push(needles.includes(compact) ? compact : tokens[i]);
      i += 1;
    }
  }
  return out;
}

function coalesceMeishiTokens(tokens: string[]) {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/명함\s*[\(（]/.test(t) && !/[\)）]/.test(t)) {
      let buf = t;
      let j = i + 1;
      while (j < tokens.length && !/[\)）]/.test(buf) && j - i < 24) {
        const next = tokens[j];
        buf += (/[,，、]$/.test(buf) || /^[,，、]/.test(next) ? '' : ',') + next;
        j += 1;
      }
      out.push(buf);
      i = j;
    } else {
      out.push(t);
      i += 1;
    }
  }
  return out;
}

function tokenizePdfText(rawText: string, colMap: StatementColMap) {
  const needles = new Set(headerNeedles(colMap));
  const lines = String(rawText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const raw: string[] = [];
  for (const line of lines) {
    const compact = normalizeKo(line);
    if (needles.has(compact)) {
      raw.push(compact);
      continue;
    }
    const parts = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    raw.push(...(parts.length ? parts : [line]));
  }
  return mergeHeaderFragments(raw, colMap);
}

const NAME_ANCHOR_HEADERS = ['품목', '품명', '상품명'];
const LAYOUT_HEADERS = [
  '월일', '품목', '품명', '상품명', '규격', '단위', '수량', '단가',
  '공급가액', '비고', '적요', '소속', '부서', '성명',
];
const TABLE_COL_HEADERS = ['월일', '품목', '품명', '규격', '수량', '단가', '공급가액', '비고'];

function isLayoutHeader(cell: string) {
  const compact = normalizeKo(cell);
  if (!compact) return false;
  return TABLE_COL_HEADERS.some((h) => {
    const n = normalizeKo(h);
    return compact === n || compact.startsWith(n);
  });
}

function isSummaryBanner(labels: string[]) {
  const c = normalizeKo(labels.join(''));
  if (!c) return false;
  if (/합계금액|공급가액세액|공급가액\+세액|일금|원整|원정/.test(c)) return true;
  if (c.includes('합계') && (c.includes('금액') || c.includes('세액')) && !c.includes('품목')) return true;
  return false;
}

function tableHeaderHits(labels: string[]) {
  const cells = labels.map((c) => normalizeKo(c));
  const joined = cells.join('');
  return TABLE_COL_HEADERS.filter((h) => {
    const n = normalizeKo(h);
    return cells.some((c) => c === n || c.startsWith(n)) || joined.includes(n);
  });
}

function isRealTableHeader(labels: string[]) {
  if (isSummaryBanner(labels)) return false;
  const hits = tableHeaderHits(labels);
  const hasItem = hits.some((h) => h === '품목' || h === '품명');
  const hasQty = hits.includes('수량');
  return hasItem && hasQty && hits.length >= 3;
}

export type StatementExtractResult = {
  lines: StatementLine[];
  warnings: string[];
};

export function mapHeaderIndices(labels: string[], colMap: StatementColMap) {
  const map = normalizeStatementColMap(colMap);
  const result: Record<StatementColKey, number> = { name: -1, dept: -1, qty: -1, price: -1 };
  const used = new Set<number>();
  (['name', 'qty', 'price', 'dept'] as StatementColKey[]).forEach((key) => {
    let best = { idx: -1, score: 0, span: 1 };
    for (let idx = 0; idx < labels.length; idx++) {
      if (used.has(idx)) continue;
      const maxSpan = Math.min(6, labels.length - idx);
      for (let span = 1; span <= maxSpan; span++) {
        let blocked = false;
        for (let k = 0; k < span; k++) {
          if (used.has(idx + k)) { blocked = true; break; }
        }
        if (blocked) break;
        const joined = labels.slice(idx, idx + span).join('');
        const score = Math.max(0, ...map[key].map((alias) => headerScore(joined, alias)));
        if (score > best.score) best = { idx, score, span };
      }
    }
    if (best.idx >= 0) {
      result[key] = best.idx;
      for (let k = 0; k < best.span; k++) used.add(best.idx + k);
    }
  });
  return result;
}

function isTotalRow(item: string) {
  const s = normalizeKo(item);
  return !s || s === '계' || s.includes('합계') || s.includes('총계');
}

function collectHeaderWarnings(
  labels: string[],
  found: Record<StatementColKey, number>,
  colMap: StatementColMap
) {
  const warnings: string[] = [];
  const map = normalizeStatementColMap(colMap);
  const present = labels.map((c) => String(c || '').trim()).filter(Boolean);
  (['name', 'dept', 'qty', 'price'] as StatementColKey[]).forEach((key) => {
    if (found[key] >= 0) return;
    const want = map[key].join(', ');
    const nearby = present.filter((label) => isLayoutHeader(label)).join(', ');
    warnings.push(
      `${key === 'name' ? '이름' : key === 'dept' ? '소속' : key === 'qty' ? '수량' : '공급가액'} 제목 "${want}"을(를) 문서 제목줄에서 찾지 못했습니다.`
      + (nearby ? ` 문서 제목줄: ${nearby}` : '')
    );
  });
  return warnings;
}

export function extractExcelStatementLines(
  rows: any[][],
  colMap: StatementColMap = DEFAULT_STATEMENT_COL_MAP
): StatementExtractResult {
  const warnings: string[] = [];
  let headerRow = -1;
  let found: Record<StatementColKey, number> = { name: -1, dept: -1, qty: -1, price: -1 };
  let labels: string[] = [];
  let bestHits = 0;

  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const rowLabels = (rows[r] || []).map((c) => String(c ?? ''));
    if (!isRealTableHeader(rowLabels)) continue;
    const hits = tableHeaderHits(rowLabels).length;
    if (hits < bestHits) continue;
    found = mapHeaderIndices(rowLabels, colMap);
    labels = rowLabels;
    headerRow = r;
    bestHits = hits;
  }

  if (headerRow < 0) {
    return { lines: [], warnings: ['문서에서 제목줄(품목·수량·비고 등)을 찾지 못했습니다.'] };
  }

  let nameIdx = found.name;
  if (nameIdx < 0) {
    const anchor = mapHeaderIndices(labels, {
      ...DEFAULT_STATEMENT_COL_MAP,
      name: NAME_ANCHOR_HEADERS,
    });
    nameIdx = anchor.name;
    if (nameIdx >= 0) {
      warnings.push(`이름 제목 "${colMap.name.join(', ')}"을(를) 찾지 못해, 품목 열에서 이름만 읽었습니다. 소속·수량·공급가액은 지정한 제목 열만 사용합니다.`);
    }
  }
  warnings.push(...collectHeaderWarnings(labels, { ...found, name: nameIdx }, colMap).filter((w) => !w.startsWith('이름')));

  if (nameIdx < 0) {
    return { lines: [], warnings: [...warnings, '이름을 찾을 열(품목 등)이 없어 행을 읽지 못했습니다.'] };
  }

  const collected: StatementLine[] = [];
  const pushRow = (item: string, row: any[]) => {
    collected.push({
      item,
      name: extractNameFromItem(item) || item.trim(),
      qty: found.qty >= 0 ? parseNumberCell(row[found.qty]) : 0,
      dept: found.dept >= 0 ? String(row[found.dept] ?? '').trim() : '',
      price: found.price >= 0 ? parseNumberCell(row[found.price]) : 0,
    });
  };

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const item = String(row[nameIdx] ?? '');
    if (isTotalRow(item) || !item.includes('명함')) continue;
    pushRow(item, row);
  }
  if (collected.length === 0) {
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const item = String(row[nameIdx] ?? '');
      if (isTotalRow(item)) continue;
      const name = extractNameFromItem(item) || item.trim();
      if (!name || !/[가-힣A-Za-z]{2,}/.test(name)) continue;
      pushRow(item, row);
    }
  }
  const lines = collected.flatMap(expandLineByNames);
  return { lines, warnings };
}

function isSpecCell(value: string) {
  return /^\d+\s*[*xX×]\s*\d+/.test(value.trim());
}

function isQtyCell(value: string) {
  return /^[1-9]\d{0,2}통?$/.test(value.trim());
}

function isPriceCell(value: string) {
  const s = value.trim();
  if (/[₩￦]/.test(s) || /원$/.test(s)) return true;
  if (s === '₩' || s === '￦') return true;
  if (/\d{1,3}(,\d{3})+/.test(s)) return true;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 1000;
}

function isDeptCell(value: string, knownDepts: string[]) {
  const s = value.trim();
  if (/[가-힣]{2,}(본부|센터|팀|실|단)$/.test(s)) return true;
  const compact = normalizeKo(s);
  return knownDepts.some((d) => {
    const key = normalizeKo(d);
    return key.length >= 2 && (compact.includes(key) || key.includes(compact));
  });
}

function isSameRowCompanion(value: string, knownDepts: string[]) {
  const s = value.trim();
  if (!s) return false;
  if (s.includes('명함') || s.includes('품목') || s.includes('합계')) return false;
  if (/^\d+\s*월/.test(s) || /^\d+\s*일/.test(s)) return true;
  if (s === '₩' || s === '￦' || s === '원') return true;
  return isSpecCell(s) || isQtyCell(s) || isPriceCell(s) || isDeptCell(s, knownDepts);
}

function parseQtyFromSameRow(cells: string[]) {
  for (const cell of cells) {
    if (cell.includes('명함')) continue;
    if (/[가-힣]/.test(cell) && !isQtyCell(cell)) continue;
    if (isSpecCell(cell) || isPriceCell(cell)) continue;
    const raw = cell.replace(/통$/, '').trim();
    if (/^[1-9]\d{0,1}$/.test(raw)) return parseInt(raw, 10);
  }
  const withoutName = cells.join(' ')
    .replace(/명함\s*[\(（][^)）]*[\)）]/g, ' ')
    .replace(/[\(（][^)）]*[\)）]/g, ' ')
    .replace(/₩[\d,]+/g, ' ')
    .replace(/\d{1,3}(?:,\d{3})+(?:원)?/g, ' ')
    .replace(/\d+\s*[*xX×]\s*\d+/g, ' ')
    .replace(/\d+\s*월/g, ' ');
  const nums = (withoutName.match(/\d+/g) || []).map((n) => parseInt(n, 10));
  return nums.find((n) => n >= 1 && n <= 30) || 0;
}

function parseRowCells(cells: string[]): StatementLine {
  const item = cells[0] || '';
  const orgCell = [...cells].reverse().find((c) => /[가-힣]{2,}(본부|센터|팀|실|단)/.test(c)) || '';
  return {
    item: cells.join(' '),
    name: extractNameFromItem(item) || extractNameFromItem(cells.join(' ')),
    qty: parseQtyFromSameRow(cells),
    dept: orgCell.trim(),
    price: parsePriceFromCells(cells),
  };
}

function shiftOffsetsIfNoDateCol(
  row: string[],
  offsets: Record<StatementColKey, number>
): Record<StatementColKey, number> {
  if (offsets.name <= 0) return offsets;
  const nameCell = String(row[offsets.name] || '');
  const first = String(row[0] || '');
  const firstIsName = first.includes('명함') || /^[가-힣]{2,}$/.test(normalizeKo(first));
  if (firstIsName && !nameCell.includes('명함')) {
    const shift = offsets.name;
    return {
      name: Math.max(0, offsets.name - shift),
      qty: offsets.qty >= 0 ? offsets.qty - shift : -1,
      dept: offsets.dept >= 0 ? offsets.dept - shift : -1,
      price: offsets.price >= 0 ? offsets.price - shift : -1,
    };
  }
  return offsets;
}

function lineFromMappedRow(
  row: string[],
  offsets: Record<StatementColKey, number>
): StatementLine {
  const item = offsets.name >= 0 ? (row[offsets.name] || '') : (row[0] || '');
  const qtyCell = offsets.qty >= 0 ? row[offsets.qty] : '';
  const deptCell = offsets.dept >= 0 ? row[offsets.dept] : '';
  const priceCell = offsets.price >= 0 ? row[offsets.price] : '';
  return {
    item: item || row[0] || '',
    name: extractNameFromItem(item) || item.trim(),
    qty: offsets.qty >= 0 ? (parseNumberCell(qtyCell) || parseQtyFromSameRow([qtyCell])) : 0,
    dept: offsets.dept >= 0 ? String(deptCell || '').trim() : '',
    price: offsets.price >= 0 ? (parseNumberCell(priceCell) || parsePriceFromSameRow(priceCell)) : 0,
  };
}

function isNameAnchor(token: string, knownNames: string[], preferMeishi = false) {
  const s = String(token || '').trim();
  if (!s || isTotalRow(s)) return false;
  if (s.includes('명함')) return true;
  if (preferMeishi) return false;
  const compact = normalizeKo(s);
  return knownNames.some((n) => {
    const key = normalizeKo(n);
    return key.length >= 2 && compact.includes(key);
  });
}

function findPdfHeaderLayout(tokens: string[], colMap: StatementColMap) {
  let best: {
    bodyStart: number;
    colCount: number;
    offsets: Record<StatementColKey, number>;
    labels: string[];
    nameFallback: boolean;
    score: number;
  } | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const win = tokens.slice(i, i + 16);
    if (!isRealTableHeader(win)) continue;
    const hits = tableHeaderHits(win);
    const found = mapHeaderIndices(win, colMap);
    const lastHitAt = Math.max(
      0,
      ...win.map((cell, idx) => (isLayoutHeader(cell) ? idx : -1)),
      found.name,
      found.qty,
      found.dept,
      found.price
    );
    if (lastHitAt < 1 || lastHitAt > 12) continue;
    let nameIdx = found.name;
    if (nameIdx < 0) {
      nameIdx = mapHeaderIndices(win, { ...colMap, name: NAME_ANCHOR_HEADERS }).name;
    }
    const candidate = {
      bodyStart: i + lastHitAt + 1,
      colCount: lastHitAt + 1,
      offsets: { ...found, name: nameIdx },
      labels: win.slice(0, lastHitAt + 1),
      nameFallback: found.name < 0 && nameIdx >= 0,
      score: hits.length,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

/** 제목줄(설정한 칼럼명) 인식 후, 이름이 있는 가로 행의 같은 열만 읽는다. */
export function extractPdfStatementLines(
  rawText: string,
  _knownDepts: string[],
  colMap: StatementColMap = DEFAULT_STATEMENT_COL_MAP,
  knownNames: string[] = []
): StatementExtractResult {
  const text = String(rawText || '');
  const tokens = coalesceMeishiTokens(tokenizePdfText(text, colMap));
  const warnings: string[] = [];
  const results: StatementLine[] = [];
  const layout = findPdfHeaderLayout(tokens, colMap);
  const preferMeishi = tokens.some((t) => String(t).includes('명함'));

  if (layout) {
    if (layout.nameFallback) {
      warnings.push(`이름 제목 "${colMap.name.join(', ')}"을(를) 찾지 못해, 품목 열에서 이름만 읽었습니다.`);
    }
    warnings.push(...collectHeaderWarnings(layout.labels, layout.offsets, colMap).filter((w) => !(layout.nameFallback && w.startsWith('이름'))));
    const body = tokens.slice(layout.bodyStart);
    let i = 0;
    while (i < body.length) {
      const nameCell = body[i];
      if (!isNameAnchor(nameCell, knownNames, preferMeishi)) {
        i += 1;
        continue;
      }
      const row = body.slice(i, i + layout.colCount);
      const nextNameAt = row.slice(1).findIndex((cell) => isNameAnchor(cell, knownNames, preferMeishi));
      const cells = nextNameAt >= 0 ? row.slice(0, nextNameAt + 1) : row;
      const padded = Array.from({ length: layout.colCount }, (_, idx) => cells[idx] || '');
      const offsets = shiftOffsetsIfNoDateCol(padded, layout.offsets);
      results.push(...expandLineByNames(lineFromMappedRow(padded, offsets)));
      i += Math.max(cells.length, 1);
    }
    return { lines: results, warnings };
  }

  warnings.push('문서 제목줄을 확실히 잡지 못해, 명함(성명)이 있는 행만 읽었습니다. 칼럼 제목을 문서와 같게 지정해 주세요.');
  let i = 0;
  while (i < tokens.length) {
    if (!isNameAnchor(tokens[i], knownNames, true)) {
      i += 1;
      continue;
    }
    const row = [tokens[i]];
    let j = i + 1;
    while (j < tokens.length && row.length < 12) {
      const next = tokens[j];
      if (isNameAnchor(next, knownNames, true)) break;
      if (!isSameRowCompanion(next, [])) break;
      row.push(next);
      j += 1;
      if (/[가-힣]{2,}(본부|센터|팀|실|단)/.test(next)) break;
    }
    results.push(...expandLineByNames(parseRowCells(row)));
    i = Math.max(j, i + 1);
  }

  if (results.length === 0) {
    const re = /명함\s*[\(（]([^)）]+)[\)）]\s*(?:(\d+\s*[*xX×]\s*\d+)\s*)?(?:[₩￦][\d,]+\s*)*?([1-9]\d{0,1})(?:통)?(?!\d)([\s\S]{0,48})/g;
    let m: RegExpExecArray | null;
    const collapsed = text.replace(/[ \t]+/g, ' ');
    while ((m = re.exec(collapsed))) {
      const tail = m[4] || '';
      const stop = tail.split(/명함|품목|합계/)[0];
      const org = stop.match(/([가-힣]{2,}(?:본부|센터|팀|실|단))/);
      results.push(...expandLineByNames({
        name: m[1].trim(),
        qty: parseInt(m[3], 10),
        dept: org?.[1] || '',
        price: parsePriceFromSameRow(stop),
        item: `명함(${m[1].trim()})`,
      }));
    }
  }

  return { lines: results, warnings };
}

function parsePriceFromCells(cells: string[]) {
  const prices = cells
    .filter((c) => !c.includes('명함') && !c.includes('합계') && c.trim() !== '계')
    .map((c) => parseNumberCell(c))
    .filter((n) => n >= 1000 && n <= 2_000_000);
  if (prices.length) return prices[prices.length - 1];
  return parsePriceFromSameRow(cells.join(' '));
}

function parsePriceFromSameRow(rowText: string) {
  const text = String(rowText || '').replace(/명함\s*[\(（][^)）]*[\)）]/g, ' ');
  const pickLast = (nums: number[]) => {
    const ok = nums.filter((n) => Number.isFinite(n) && n >= 1000 && n <= 2_000_000);
    return ok.length ? ok[ok.length - 1] : 0;
  };
  const won = [...text.matchAll(/[₩￦]\s*([\d,]+)/g)].map((m) => parseInt(m[1].replace(/,/g, ''), 10));
  if (won.length) return pickLast(won);
  const comma = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)/g)].map((m) => parseInt(m[1].replace(/,/g, ''), 10));
  if (comma.length) return pickLast(comma);
  const plain = [...text.matchAll(/(?:^|[^\d])(\d{4,7})(?:[^\d]|$)/g)].map((m) => parseInt(m[1], 10));
  return pickLast(plain);
}
