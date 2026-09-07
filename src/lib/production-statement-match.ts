/**
 * 제작물/현판 외주 거래명세표 파싱 및 N:1 집계 교차 검증 엔진
 */

export type StatementColKey = 'name' | 'spec' | 'qty' | 'unitPrice' | 'price' | 'dept';

export type StatementColMap = Record<StatementColKey, string[]>;

export const PRODUCTION_STATEMENT_COL_FIELDS: { key: StatementColKey; label: string; hint: string }[] = [
  { key: 'name', label: '품목', hint: '명세표의 품목 열 (예: 품목, 품명, 내역)' },
  { key: 'spec', label: '규격', hint: '명세표의 규격 열 (예: 규격, 사이즈)' },
  { key: 'qty', label: '수량', hint: '명세표의 수량 열 (예: 수량, 수 량)' },
  { key: 'unitPrice', label: '단가', hint: '명세표의 단가 열 (예: 단가, 단 가)' },
  { key: 'price', label: '공급가액', hint: '명세표의 공급가액 열 (예: 공급가액, 공급가, 금액)' },
  { key: 'dept', label: '비고(소속)', hint: '명세표의 비고/소속 열 (예: 비고, 소속, 부서, 센터)' },
];

export const DEFAULT_PRODUCTION_COL_MAP: StatementColMap = {
  name: ['품목', '품명', '내역', '항목'],
  spec: ['규격', '사이즈', '크기'],
  qty: ['수량'],
  unitPrice: ['단가'],
  price: ['공급가액', '공급가', '금액'],
  dept: ['비고', '소속', '센터', '부서'],
};

/**
 * 인증의 종류 풀네임 ↔ 명세표 줄임말 약어 맵핑
 * 사용자가 UI ⚙ 설정창에서 실시간 수정 가능
 */
export type CertTypeAliasMap = Record<string, string[]>;

export const DEFAULT_CERT_TYPE_ALIASES: CertTypeAliasMap = {
  '녹색건축인증': ['녹색건축', '녹색', '녹색건축현판'],
  '건축물에너지효율등급': ['에너지효율', '에너지', '에너지효율현판'],
  '제로에너지건축물인증': ['제로에너지', '제로', 'ZEB', '(구) 제로에너지', '제로에너지현판'],
  '지능형건축물인증': ['지능형건축물', '지능형', 'IBS'],
  '장애물없는생활환경(BF)인증': ['BF', 'bf', 'BF 인증', 'bf 인증', 'bf 현판', '생활환경', '장애물없는'],
  'ISO경영시스템인증': ['ISO', 'iso', 'ISO 인증', 'iso 인증', '스텐현판', '스텐'],
  '인증기준 해설서': ['해설서'],
  '스텐현판': ['스텐현판', '스텐', '실외 스텐현판', '스테인레스'],
  '주물현판': ['주물현판', '주물', '동주물'],
  '텅스텐현판': ['텅스텐현판', '텅스텐'],
  '기타': ['기타'],
};

export type ParsedStatementRow = {
  rawIndex: number;
  rawItem: string;
  categoryTitle: string; // 예: "녹색건축현판", "녹색건축 주물현판", "bf 현판", "스텐현판"
  isJumul: boolean; // "주물" 키워드 포함 여부
  extractedProjects: string[]; // 괄호 안에서 콤마로 분리된 프로젝트명 목록
  spec: string; // 예: "400*300"
  qty: number; // 명세표 수량
  unitPrice: number; // 명세표 단가
  supplyPrice: number; // 공급가액
  dept: string; // 비고(소속)
};

export type ProductionDbItem = {
  id: string;
  postNumber: string;
  category: string;
  userName: string;
  deptName: string;
  deptHead?: string;
  title: string;
  quantity: number;
  certType: string; // 인증의 종류
  plateLabel: string; // 현판 품목 (주물현판 / 텅스텐 / 스텐현판 등)
  plateSize: string; // 규격 (400*300 등)
  projectName: string; // 프로젝트명/건물명
  isJumul: boolean; // 주물 여부
};

export type ItemMatchResult = ProductionDbItem & {
  matchedRowIndex: number | null; // 매칭된 명세표 행 인덱스
  matchedRowTitle: string;
  docProjectName: string; // 명세표 상 표기된 프로젝트명
  docUnitPrice: number; // 확정 단가
  nameMatch: boolean; // 프로젝트명 일치
  deptMatch: boolean; // 소속 일치
  certMatch: boolean; // 인증종류/품목 일치
  materialMatch: boolean; // 주물/일반 재질 일치
  matchStatus: 'match' | 'mismatch' | 'manual';
  adminOverride: boolean;
  resultNote: string;
};

export type GroupMatchSummary = {
  rowIndex: number;
  categoryTitle: string;
  isJumul: boolean;
  spec: string;
  dept: string;
  docQty: number;
  docUnitPrice: number;
  docSupplyPrice: number;
  matchedDbCount: number; // 매칭된 DB 건수
  matchedDbQty: number; // 매칭된 DB 수량 합계
  isQtyMatched: boolean;
  isAllItemMatched: boolean;
  dbItemIds: string[];
};

export function normalizeKo(value: string | null | undefined): string {
  return String(value || '')
    .replace(/[\s\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '')
    .replace(/[·ㆍ._\-()（）]/g, '')
    .toLowerCase();
}

/** 텍스트 내 괄호 안 프로젝트 목록 추출 (중첩 괄호 보존 및 지원) */
export function extractProjectsFromItemText(itemText: string): { title: string; projects: string[] } {
  const text = String(itemText || '').trim();

  const firstOpenParen = text.indexOf('(');
  const firstOpenFull = text.indexOf('（');
  let firstOpen = -1;
  if (firstOpenParen >= 0 && firstOpenFull >= 0) firstOpen = Math.min(firstOpenParen, firstOpenFull);
  else if (firstOpenParen >= 0) firstOpen = firstOpenParen;
  else if (firstOpenFull >= 0) firstOpen = firstOpenFull;

  const lastClose = Math.max(text.lastIndexOf(')'), text.lastIndexOf('）'));

  if (firstOpen === -1 || lastClose === -1 || lastClose <= firstOpen) {
    return { title: text.replace(/\s+/g, ' ').trim(), projects: [] };
  }

  const title = (text.slice(0, firstOpen) + ' ' + text.slice(lastClose + 1)).replace(/\s+/g, ' ').trim();
  const inside = text.slice(firstOpen + 1, lastClose);

  // 쉼표 분리 (중첩된 괄호 내부의 쉼표는 보존)
  const projects: string[] = [];
  let depth = 0;
  let cur = '';

  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === '(' || ch === '（') depth++;
    else if (ch === ')' || ch === '）') depth--;

    if ((ch === ',' || ch === '，' || ch === '\n' || ch === '\r') && depth === 0) {
      const clean = cur.replace(/\s+/g, ' ').trim();
      if (clean) projects.push(clean);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const cleanLast = cur.replace(/\s+/g, ' ').trim();
  if (cleanLast) projects.push(cleanLast);

  return { title, projects };
}

/** 명세표 1개 행 파싱 */
export function parseStatementRow(
  rawItem: string,
  spec: string,
  qty: number,
  unitPrice: number,
  supplyPrice: number,
  dept: string,
  index: number
): ParsedStatementRow {
  const { title, projects } = extractProjectsFromItemText(rawItem);
  const isJumul = title.includes('주물') || rawItem.includes('주물');

  return {
    rawIndex: index,
    rawItem,
    categoryTitle: title,
    isJumul,
    extractedProjects: projects,
    spec: String(spec || '').trim(),
    qty: Number(qty) || 0,
    unitPrice: Number(unitPrice) || 0,
    supplyPrice: Number(supplyPrice) || 0,
    dept: String(dept || '').trim(),
  };
}

/** 인증의 종류 또는 품목 레이블과 명세표 품목명 매칭 검사 */
export function matchesCertOrPlateType(
  dbCertType: string,
  dbPlateLabel: string,
  docTitle: string,
  aliasMap: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES
): boolean {
  const docNorm = normalizeKo(docTitle);
  const dbCertNorm = normalizeKo(dbCertType);
  const dbPlateNorm = normalizeKo(dbPlateLabel);

  if (docNorm && dbCertNorm && (docNorm.includes(dbCertNorm) || dbCertNorm.includes(docNorm))) return true;
  if (docNorm && dbPlateNorm && (docNorm.includes(dbPlateNorm) || dbPlateNorm.includes(docNorm))) return true;

  // 약어 사전을 통한 교차 검사
  for (const [fullType, aliases] of Object.entries(aliasMap)) {
    const allKeywords = [fullType, ...aliases].map(normalizeKo).filter(Boolean);

    const matchesDb = allKeywords.some(
      (kw) => dbCertNorm.includes(kw) || kw.includes(dbCertNorm) || dbPlateNorm.includes(kw) || kw.includes(dbPlateNorm)
    );

    if (matchesDb) {
      const matchesDoc = allKeywords.some((kw) => docNorm.includes(kw) || kw.includes(docNorm));
      if (matchesDoc) return true;
    }
  }

  return false;
}

/** 프로젝트명 매칭 검사 (공백/특수문자 무시 부분일치) */
export function matchesProjectName(dbProject: string, docProject: string): boolean {
  const dbNorm = normalizeKo(dbProject);
  const docNorm = normalizeKo(docProject);

  if (!dbNorm || !docNorm) return false;
  if (dbNorm === docNorm) return true;
  if (dbNorm.includes(docNorm) || docNorm.includes(dbNorm)) return true;

  // 3글자 이상 겹치는 서브스트링 검사 (예: "구제로빌딩" ↔ "구제 로빌딩", "잘한다기업" ↔ "잘한다기업")
  if (dbNorm.length >= 3 && docNorm.length >= 3) {
    for (let i = 0; i <= dbNorm.length - 3; i++) {
      const sub = dbNorm.slice(i, i + 3);
      if (docNorm.includes(sub)) return true;
    }
  }

  return false;
}

/** 전체 DB 신청건과 파싱된 명세표 행들 간의 N:1 집계 교차 검증 */
export function runProductionStatementMatch(
  dbItems: ProductionDbItem[],
  statementRows: ParsedStatementRow[],
  aliasMap: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES,
  manualOverrides: Record<string, { rowIndex: number; unitPrice?: number }> = {}
): {
  itemMatches: ItemMatchResult[];
  groupSummaries: GroupMatchSummary[];
  totalDocPrice: number;
  matchedBatchDocPrice: number;
  totalDbCount: number;
  allMatched: boolean;
  unmatchedRows: ParsedStatementRow[];
} {
  const itemMatches: ItemMatchResult[] = [];
  const matchedDbIdsByRow: Record<number, string[]> = {};

  // 초기화
  statementRows.forEach((r) => {
    matchedDbIdsByRow[r.rawIndex] = [];
  });

  for (const item of dbItems) {
    // 1. 수기 지정(강제 매칭) 여부 우선 확인
    if (manualOverrides[item.id] !== undefined) {
      const override = manualOverrides[item.id];
      const targetRow = statementRows.find((r) => r.rawIndex === override.rowIndex);
      const unitPrice = override.unitPrice ?? targetRow?.unitPrice ?? 0;

      matchedDbIdsByRow[override.rowIndex]?.push(item.id);
      itemMatches.push({
        ...item,
        matchedRowIndex: override.rowIndex,
        matchedRowTitle: targetRow?.categoryTitle || '수기 지정',
        docProjectName: item.projectName,
        docUnitPrice: unitPrice,
        nameMatch: true,
        deptMatch: true,
        certMatch: true,
        materialMatch: true,
        matchStatus: 'manual',
        adminOverride: true,
        resultNote: '관리자 수기 강제 매칭',
      });
      continue;
    }

    // 2. 자동 매칭 탐색
    let bestMatch: {
      row: ParsedStatementRow;
      matchedProject: string;
      nameMatch: boolean;
      deptMatch: boolean;
      certMatch: boolean;
      materialMatch: boolean;
      score: number;
    } | null = null;

    for (const row of statementRows) {
      // 기타 품목(명함, 인증서용지 등) 제외
      if (
        row.categoryTitle.includes('명함') ||
        row.categoryTitle.includes('인증서용지') ||
        row.categoryTitle.includes('봉투')
      ) {
        continue;
      }

      // 프로젝트명 체크 (괄호 안 목록)
      let nameMatch = false;
      let matchedProject = '';

      for (const docProj of row.extractedProjects) {
        if (matchesProjectName(item.projectName, docProj)) {
          nameMatch = true;
          matchedProject = docProj;
          break;
        }
      }

      // 프로젝트명이 아예 안 맞으면 후보 제외
      if (!nameMatch) continue;

      // 소속 체크
      const deptMatch =
        !row.dept ||
        !item.deptName ||
        normalizeKo(row.dept).includes(normalizeKo(item.deptName)) ||
        normalizeKo(item.deptName).includes(normalizeKo(row.dept));

      // 주물 재질 일치 체크
      const materialMatch = item.isJumul === row.isJumul;

      // 인증종류/품목(스텐/주물/텅스텐) 일치 체크
      const certMatch = matchesCertOrPlateType(item.certType, item.plateLabel, row.categoryTitle, aliasMap);

      // 점수 계산 (프로젝트명 일치 기본 100점)
      let score = 100;
      if (deptMatch) score += 30;
      if (materialMatch) score += 30;
      if (certMatch) score += 20;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          row,
          matchedProject,
          nameMatch,
          deptMatch,
          certMatch,
          materialMatch,
          score,
        };
      }
    }

    if (bestMatch && bestMatch.nameMatch) {
      matchedDbIdsByRow[bestMatch.row.rawIndex]?.push(item.id);
      // 실무상 외주사 명세서의 '비고(소속)'는 오기재되는 경우가 많으므로,
      // 프로젝트명과 재질이 정확히 맞으면 기본 일치로 판별하되 안내 문구를 명시함
      const isFullMatch = bestMatch.nameMatch && bestMatch.materialMatch && bestMatch.certMatch;

      itemMatches.push({
        ...item,
        matchedRowIndex: bestMatch.row.rawIndex,
        matchedRowTitle: bestMatch.row.categoryTitle,
        docProjectName: bestMatch.matchedProject,
        docUnitPrice: bestMatch.row.unitPrice || Math.round(bestMatch.row.supplyPrice / (bestMatch.row.qty || 1)),
        nameMatch: bestMatch.nameMatch,
        deptMatch: bestMatch.deptMatch,
        certMatch: bestMatch.certMatch,
        materialMatch: bestMatch.materialMatch,
        matchStatus: isFullMatch ? 'match' : 'mismatch',
        adminOverride: false,
        resultNote: isFullMatch
          ? bestMatch.deptMatch
            ? '일치 (프로젝트명·품목·재질·소속 완벽 일치)'
            : '일치 (프로젝트명·품목·재질 일치 / 명세표 소속 표기 상이)'
          : `불일치 (${[!bestMatch.materialMatch && '재질(주물/일반)', !bestMatch.certMatch && '인증/품목종류', !bestMatch.deptMatch && '소속'].filter(Boolean).join(', ')} 확인 필요)`,
      });
    } else {
      itemMatches.push({
        ...item,
        matchedRowIndex: null,
        matchedRowTitle: '-',
        docProjectName: '',
        docUnitPrice: 0,
        nameMatch: false,
        deptMatch: false,
        certMatch: false,
        materialMatch: false,
        matchStatus: 'mismatch',
        adminOverride: false,
        resultNote: '명세표 내 일치하는 프로젝트명을 찾지 못함 (수기 확인 필요)',
      });
    }
  }

  // 그룹별 집계 요약 생성 (명함 등 제외한 현판/제작물 그룹)
  const productionGroups = statementRows.filter(
    (r) =>
      !r.categoryTitle.includes('명함') &&
      !r.categoryTitle.includes('인증서용지') &&
      !r.categoryTitle.includes('봉투')
  );

  const groupSummaries: GroupMatchSummary[] = productionGroups.map((row) => {
    const dbIds = matchedDbIdsByRow[row.rawIndex] || [];
    const matchedItems = itemMatches.filter((m) => dbIds.includes(m.id));
    const matchedDbQty = matchedItems.reduce((sum, m) => sum + (m.quantity || 1), 0);
    const isQtyMatched = row.qty === matchedDbQty;
    const isAllItemMatched =
      matchedItems.length > 0 &&
      matchedItems.every((m) => m.matchStatus === 'match' || m.adminOverride);

    return {
      rowIndex: row.rawIndex,
      categoryTitle: row.categoryTitle,
      isJumul: row.isJumul,
      spec: row.spec,
      dept: row.dept,
      docQty: row.qty,
      docUnitPrice: row.unitPrice,
      docSupplyPrice: row.supplyPrice,
      matchedDbCount: matchedItems.length,
      matchedDbQty,
      isQtyMatched,
      isAllItemMatched: isQtyMatched && isAllItemMatched,
      dbItemIds: dbIds,
    };
  });

  // 전체 명세서 공급가액 (명함 제외 제작물 전체 합계)
  const totalDocPrice = productionGroups.reduce((sum, g) => sum + g.supplyPrice, 0);

  // 현재 선택된 묶음 건에 매칭된 청구 단가 합계
  const matchedBatchDocPrice = itemMatches.reduce(
    (sum, m) => sum + (m.docUnitPrice || 0) * (m.quantity || 1),
    0
  );

  const totalDbCount = dbItems.length;
  const allMatched =
    itemMatches.length > 0 &&
    itemMatches.every((m) => m.matchStatus === 'match' || m.adminOverride);

  const unmatchedRows = productionGroups.filter((r) => {
    const dbIds = matchedDbIdsByRow[r.rawIndex] || [];
    return dbIds.length === 0;
  });

  return {
    itemMatches,
    groupSummaries,
    totalDocPrice,
    matchedBatchDocPrice,
    totalDbCount,
    allMatched,
    unmatchedRows,
  };
}

/** 엑셀 테이블에서 명세표 행 추출 */
export function extractProductionExcelRows(
  rows: any[][],
  colMap: StatementColMap = DEFAULT_PRODUCTION_COL_MAP
): ParsedStatementRow[] {
  let headerRow = -1;
  let found: Record<StatementColKey, number> = {
    name: -1,
    spec: -1,
    qty: -1,
    unitPrice: -1,
    price: -1,
    dept: -1,
  };

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const rowLabels = (rows[r] || []).map((c) => String(c ?? '').trim());
    const mapped: Record<StatementColKey, number> = {
      name: -1,
      spec: -1,
      qty: -1,
      unitPrice: -1,
      price: -1,
      dept: -1,
    };
    (Object.keys(colMap) as StatementColKey[]).forEach((key) => {
      const aliases = colMap[key] || [];
      const idx = rowLabels.findIndex((l) =>
        aliases.some((a) => normalizeKo(l).includes(normalizeKo(a)))
      );
      if (idx >= 0) mapped[key] = idx;
    });

    if (mapped.name >= 0 && (mapped.qty >= 0 || mapped.price >= 0)) {
      headerRow = r;
      found = mapped;
      break;
    }
  }

  if (headerRow < 0) return [];

  const results: ParsedStatementRow[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const item = String(row[found.name] ?? '').trim();
    if (!item || item.includes('합계') || item.includes('소계') || item === '계') continue;

    const spec = found.spec >= 0 ? String(row[found.spec] ?? '').trim() : '';
    const qty = found.qty >= 0 ? parseInt(String(row[found.qty] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    const unitPrice = found.unitPrice >= 0 ? parseInt(String(row[found.unitPrice] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    const supplyPrice = found.price >= 0 ? parseInt(String(row[found.price] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    const dept = found.dept >= 0 ? String(row[found.dept] ?? '').trim() : '';

    results.push(parseStatementRow(item, spec, qty, unitPrice, supplyPrice, dept, results.length));
  }

  return results;
}
