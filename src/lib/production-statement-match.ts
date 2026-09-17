/**
 * 제작물/현판 외주 거래명세표 파싱 및 N:1 집계 교차 검증 엔진
 */

export type StatementColKey =
  | 'certType'
  | 'plateItem'
  | 'spec'
  | 'projectName'
  | 'qty'
  | 'unitPrice'
  | 'price'
  | 'dept';

/**
 * 1. 제목행 칼럼명칭 검색 키워드
 */
export type StatementColumnHeaderKeywords = {
  certType: string[]; // "인증종류" 검색용 칼럼명 (예: 인증종류, 인증, 품목, 품명, 내역)
  plateItem: string[]; // "현판품목" 검색용 칼럼명 (예: 현판품목, 현판, 명판, 품목, 품명, 내역)
  spec: string[]; // "규격" 검색용 칼럼명 (예: 규격, 사이즈, 크기)
  projectName: string[]; // "프로젝트명" 검색용 칼럼명 (예: 프로젝트명, 프로젝트, 건물명, 내역, 항목, 비고, 품목)
  quantity: string[]; // "수량" 검색용 칼럼명 (예: 수량, 수 량)
  dept: string[]; // "조직(소속)" 검색용 칼럼명 (예: 소속, 조직, 비고, 센터, 부서, 거래처)
  unitPrice: string[]; // "단가" 검색용 칼럼명 (예: 단가, 단 가)
  supplyPrice: string[]; // "공급가액" 검색용 칼럼명 (예: 공급가액, 공급가, 금액, 합계)
};

/** @deprecated 하위 호환 — 현판(SIGN) 기본값과 동일. 신규 코드는 DEFAULT_COLUMN_HEADERS_SIGN 사용 */
export const DEFAULT_COLUMN_HEADERS: StatementColumnHeaderKeywords = {
  certType: ['품목'],
  plateItem: ['품목'],
  spec: ['규격'],
  projectName: ['품목'],
  quantity: ['수량'],
  dept: ['비고'],
  unitPrice: ['단가'],
  supplyPrice: ['공급가액'],
};

/** 현판(SIGN) 제목행 칼럼 검색 기본값 */
export const DEFAULT_COLUMN_HEADERS_SIGN: StatementColumnHeaderKeywords = {
  certType: ['품목'],
  plateItem: ['품목'],
  spec: ['규격'],
  projectName: ['품목'],
  quantity: ['수량'],
  dept: ['비고'],
  unitPrice: ['단가'],
  supplyPrice: ['공급가액'],
};

/** 제본(JEBON) 제목행 칼럼 검색 기본값 — 한생미디어 납품내역서(원고명/판형/부수/청구금액) 기준 */
export const DEFAULT_COLUMN_HEADERS_JEBON: StatementColumnHeaderKeywords = {
  certType: ['원고명'], // 인증종류 문구가 원고명에 포함됨 (예: 녹색건축인증 평가서-…)
  plateItem: ['판형', '판형(절)'], // 제본 판형 열
  spec: ['판형', '판형(절)'], // 규격 역할도 동일 열
  projectName: ['원고명'], // 프로젝트명은 원고명 하이픈(-) 뒤
  quantity: ['부수'], // 신청수량 = 부수
  dept: [], // 부서 열은 보통 회사명(인증원)만 있어 매칭에 쓰지 않음
  unitPrice: [], // 이 업체 명세서에 단가 열 없음
  supplyPrice: ['청구금액'],
};

/** 기타제작물(PRINT) 제목행 칼럼 검색 기본값 — 한생미디어 납품내역서(원고명/부수/청구금액) 기준 */
export const DEFAULT_COLUMN_HEADERS_PRINT: StatementColumnHeaderKeywords = {
  certType: ['원고명', '품목', '품명'],
  plateItem: ['원고명', '품목', '품명'],
  spec: ['판형', '판형(절)', '규격'],
  projectName: [],
  quantity: ['부수', '수량'],
  dept: ['비고'],
  unitPrice: ['단가'],
  supplyPrice: ['청구금액', '공급가액', '금액'],
};

/** 사무문구류(OFFICE_SUPPLIES) 제목행 칼럼 검색 기본값 — 드림디포 거래명세서(품명/수량/단가/금액) */
export const DEFAULT_COLUMN_HEADERS_OFFICE: StatementColumnHeaderKeywords = {
  certType: ['품명', '품목', '제품명'],
  plateItem: ['품명', '품목', '제품명'],
  spec: ['규격'],
  projectName: [],
  quantity: ['수량'],
  dept: [], // 부서는 엑셀 시트(탭)명으로 부여
  unitPrice: ['단가'],
  supplyPrice: ['금액', '합계', '합계(원)', '공급가액'],
};

/**
 * 2. 인증의 종류 풀네임 ↔ 명세표 매칭 문구(약어) 맵핑
 */
export type CertTypeAliasMap = Record<string, string[]>;

/** 현판(SIGN) 인증종류 매칭 기본값 */
export const DEFAULT_CERT_TYPE_ALIASES: CertTypeAliasMap = {
  '녹색건축인증': ['녹색건축'],
  'BF 인증': ['BF', 'bf', ],
  '교육시설안전인증': ['교육시설안전'],
  '건축물에너지효율등급인증': ['에너지효율'],
  '제로에너지건축물인증': ['제로에너지'],
  'ISO 인증': [ ],
  '기타': ['기타'],
};

/**
 * 제본(JEBON) 인증종류 매칭 기본값
 * — seed jebonCerts 등록 순서와 동일 (일반제본 → 녹색 → 결로 → 에너지 → 제로에너지)
 */
export const DEFAULT_CERT_TYPE_ALIASES_JEBON: CertTypeAliasMap = {
  '일반제본': [],
  '녹색건축인증 평가서': ['녹색건축인증 평가서', '녹색건축'],
  '결로방지 성능평가 결과 보고서': [
    '결로방지',
    '결로',
    '공동주택 결로방지 성능평가 보고서',
    '결로방지 성능평가',
  ],
  '건축물에너지효율등급인증 평가서': [
    '건축물에너지효율등급 평가서',
    '건축물에너지효율등급인증 평가서',
    '에너지효율',
  ],
  '제로에너지건축물인증 평가서': ['제로에너지', '건축물제로에너지'],
};

/**
 * 3. 현판 품목 풀네임 ↔ 명세표 매칭 문구(약어) 맵핑
 */
export type PlateItemAliasMap = Record<string, string[]>;

/** 현판(SIGN) 품목 매칭 기본값 */
export const DEFAULT_PLATE_ITEM_ALIASES: PlateItemAliasMap = {
  '텅스텐현판': ['현판'],
  '주물현판': ['주물현판', '주물'],
  '스텐현판': ['스텐현판', '스텐'],
  '신주현판': ['신주현판', '신주'],
  'ISO 실외 스텐현판_기업명표기': ['스텐현판', '스텐'],
  'ISO 실외 스텐현판_통합경영': ['스텐현판', '스텐'],
  'ISO 실외 스텐현판_기업명 미표기': ['스텐현판', '스텐'],
  'ISO 실내 메탈목재상패': ['목판상패', '메탈목재상패'],
  'ISO 실내 원형 은쟁반패': ['은쟁반패'],
  'ISO 실내 팔각형 은쟁반패': ['은쟁반패'],
  '기타': ['기타'],
};

/** 제본(JEBON) 판형/규격 매칭 기본값 — seed jebonSizes 순서 */
export const DEFAULT_PLATE_ITEM_ALIASES_JEBON: PlateItemAliasMap = {
  'A4': ['A4', 'a4', '국배판'],
  'B5': ['B5', 'b5', '4X6배판'],
  'A5': ['A5', 'a5'],
  'B6': ['B6', 'b6'],
  '16절': ['16절'],
  '비규격': ['비규격'],
};

/** 기타제작물(PRINT) 품목 매칭 기본값 — seed print items 기준 */
export const DEFAULT_PLATE_ITEM_ALIASES_PRINT: PlateItemAliasMap = {
  '인증서 용지': ['인증서용지', '인증서 용지'],
  '인증서 홀더': ['인증서홀더', '인증서 홀더'],
  '쇼핑백(중)': ['쇼핑백(중)', '쇼핑백중', '쇼핑백'],
  '쇼핑백(대)': ['쇼핑백(대)', '쇼핑백대', '쇼핑백'],
  '상장케이스': ['상장케이스', '상장 케이스'],
  '컬러대봉투(양면테잎)': ['컬러대봉투', '양면테잎'],
  '경조사봉투(축의)': ['축의', '경조사봉투(축의)', '경조사봉투인쇄', '경조사봉투'],
  '경조사봉투(조의)': ['조의', '경조사봉투(조의)', '경조사봉투인쇄', '경조사봉투'],
};

/** 사무문구류(OFFICE_SUPPLIES) 품목 매칭 기본값 — 축약 품명 보조 (전용 엔진에서도 사용) */
export const DEFAULT_PLATE_ITEM_ALIASES_OFFICE: PlateItemAliasMap = {
  각티슈: ['티슈', '로션티슈', '명품로션티슈'],
  건전지: ['건전지', '알카라인', '벡셀'],
  다색리필: ['다색리필', '다색 리필'],
  물티슈: ['물티슈'],
  다용도테이프: ['다용도테이프', '스카치'],
  복사용지: ['복사용지'],
  사무문구류: ['문구', '사무용품'],
};

/**
 * 통합 명세표 매칭 규칙
 */
export type ProductionStatementRules = {
  columnHeaders: StatementColumnHeaderKeywords;
  certTypeKeywords: CertTypeAliasMap;
  plateItemKeywords: PlateItemAliasMap;
};

function cloneColumnHeaders(src: StatementColumnHeaderKeywords): StatementColumnHeaderKeywords {
  return {
    certType: [...src.certType],
    plateItem: [...src.plateItem],
    spec: [...src.spec],
    projectName: [...src.projectName],
    quantity: [...src.quantity],
    dept: [...src.dept],
    unitPrice: [...src.unitPrice],
    supplyPrice: [...src.supplyPrice],
  };
}

function cloneAliasMap(src: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(src).map(([k, v]) => [k, [...(v || [])]])
  );
}

function cloneRules(src: ProductionStatementRules): ProductionStatementRules {
  return {
    columnHeaders: cloneColumnHeaders(src.columnHeaders),
    certTypeKeywords: cloneAliasMap(src.certTypeKeywords),
    plateItemKeywords: cloneAliasMap(src.plateItemKeywords),
  };
}

/** 현판(SIGN) 전체 기본 규칙 */
export const DEFAULT_PRODUCTION_RULES_SIGN: ProductionStatementRules = {
  columnHeaders: DEFAULT_COLUMN_HEADERS_SIGN,
  certTypeKeywords: DEFAULT_CERT_TYPE_ALIASES,
  plateItemKeywords: DEFAULT_PLATE_ITEM_ALIASES,
};

/** 제본(JEBON) 전체 기본 규칙 */
export const DEFAULT_PRODUCTION_RULES_JEBON: ProductionStatementRules = {
  columnHeaders: DEFAULT_COLUMN_HEADERS_JEBON,
  certTypeKeywords: DEFAULT_CERT_TYPE_ALIASES_JEBON,
  plateItemKeywords: DEFAULT_PLATE_ITEM_ALIASES_JEBON,
};

/** 기타제작물(PRINT) 전체 기본 규칙 */
export const DEFAULT_PRODUCTION_RULES_PRINT: ProductionStatementRules = {
  columnHeaders: DEFAULT_COLUMN_HEADERS_PRINT,
  certTypeKeywords: {},
  plateItemKeywords: DEFAULT_PLATE_ITEM_ALIASES_PRINT,
};

/** 사무문구류(OFFICE_SUPPLIES) 전체 기본 규칙 */
export const DEFAULT_PRODUCTION_RULES_OFFICE: ProductionStatementRules = {
  columnHeaders: DEFAULT_COLUMN_HEADERS_OFFICE,
  certTypeKeywords: {},
  plateItemKeywords: DEFAULT_PLATE_ITEM_ALIASES_OFFICE,
};

/** @deprecated 하위 호환 — SIGN 기본값과 동일. 신규 코드는 getDefaultRulesForCategory 사용 */
export const DEFAULT_PRODUCTION_RULES: ProductionStatementRules = DEFAULT_PRODUCTION_RULES_SIGN;

/**
 * 카테고리별 기본 매칭 규칙 (SIGN / JEBON / PRINT / OFFICE_SUPPLIES)
 * — 코드에 박아 둔 카테고리 전용 기본값을 복제해서 반환
 */
export function getDefaultRulesForCategory(category: string = 'SIGN'): ProductionStatementRules {
  const cat = (category || 'SIGN').toUpperCase();
  if (cat === 'JEBON') return cloneRules(DEFAULT_PRODUCTION_RULES_JEBON);
  if (cat === 'PRINT') return cloneRules(DEFAULT_PRODUCTION_RULES_PRINT);
  if (cat === 'OFFICE_SUPPLIES') return cloneRules(DEFAULT_PRODUCTION_RULES_OFFICE);
  return cloneRules(DEFAULT_PRODUCTION_RULES_SIGN);
}

/** (구)/(통합) 제로에너지 키를 단일 키로 병합 (현판·제본 공통 마이그레이션) */
export function migrateLegacyZebCertKeywords(
  rules: ProductionStatementRules,
  category: string = 'SIGN'
): ProductionStatementRules {
  const cat = (category || 'SIGN').toUpperCase();
  const next = cloneRules(rules);
  const keywords = { ...next.certTypeKeywords };

  const isLegacySignZeb = (key: string) =>
    /\(구\)\s*제로에너지/.test(key) || /\(통합\)\s*제로에너지/.test(key);
  const isLegacyJebonZeb = (key: string) =>
    /\(구\)\s*제로에너지/.test(key) || /\(통합\)\s*제로에너지/.test(key);

  if (cat === 'SIGN') {
    const unified = '제로에너지건축물인증';
    const mergedAliases = new Set<string>(keywords[unified] || ['제로에너지']);
    for (const [key, aliases] of Object.entries(keywords)) {
      if (isLegacySignZeb(key)) {
        (aliases || []).forEach((a) => mergedAliases.add(a));
        delete keywords[key];
      }
    }
    keywords[unified] = Array.from(mergedAliases);
  } else if (cat === 'JEBON') {
    const unified = '제로에너지건축물인증 평가서';
    const mergedAliases = new Set<string>(
      keywords[unified] || ['제로에너지', '건축물제로에너지']
    );
    for (const [key, aliases] of Object.entries(keywords)) {
      if (isLegacyJebonZeb(key)) {
        (aliases || []).forEach((a) => mergedAliases.add(a));
        delete keywords[key];
      }
    }
    keywords[unified] = Array.from(mergedAliases);
  }

  next.certTypeKeywords = keywords;
  return next;
}

/**
 * 신청 마스터 라벨 목록 순서에 맞춰 매칭 키워드 맵을 동기화합니다.
 * - 마스터에 있는 항목은 순서대로 유지 (기존 문구 보존, 신규는 빈 배열)
 * - 마스터에 없는 항목은 제거
 */
export function syncAliasMapToMasterLabels(
  masterLabels: string[],
  existing: Record<string, string[]> | null | undefined,
  defaultAliases?: Record<string, string[]>
): Record<string, string[]> {
  const prev = existing || {};
  const defaults = defaultAliases || {};
  const next: Record<string, string[]> = {};
  const seen = new Set<string>();

  for (const raw of masterLabels) {
    const label = String(raw || '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    if (Array.isArray(prev[label])) {
      next[label] = [...prev[label]];
    } else if (Array.isArray(defaults[label])) {
      next[label] = [...defaults[label]];
    } else {
      next[label] = [];
    }
  }
  return next;
}

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
  plateLabel: string; // 현판 품목 (주물현판 등) 또는 제본 판형 (A4 등)
  plateSize: string; // 규격 (400*300 등) 또는 제본 실측 규격
  projectName: string; // 프로젝트명/건물명
  isJumul: boolean; // 주물 여부 (현판 전용, 제본은 항상 false)
};

export type ItemMatchResult = ProductionDbItem & {
  matchedRowIndex: number | null; // 매칭된 명세표 행 인덱스
  matchedRowTitle: string;
  docProjectName: string; // 명세표 상 표기된 프로젝트명
  docUnitPrice: number; // 확정 단가(현판:개당) / 최종금액(제본:건 합계)
  nameMatch: boolean; // 프로젝트명 일치
  deptMatch: boolean; // 소속 일치
  certMatch: boolean; // 인증종류/품목 일치
  materialMatch: boolean; // 주물/일반 재질 일치 또는 제본 판형 일치
  matchStatus: 'match' | 'mismatch' | 'manual';
  adminOverride: boolean;
  /** 관리자가 수기로 확정단가/최종금액을 입력한 경우 */
  adminPriceSet?: boolean;
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

/**
 * 규격 문자열 정규화 (예: "210*297", "297.210", "297 x 210", "230*70*320" 등)
 * - 2차원: 가로·세로 순서가 달라도 작은수*큰수로 동일 취급
 * - 3차원 이상(쇼핑백 등): 숫자 순서 유지
 */
export function normalizeSpec(spec: string | null | undefined): string {
  if (!spec) return '';
  const cleaned = String(spec).trim();
  const nums = cleaned.match(/\d+/g);
  if (nums && nums.length >= 3) {
    return nums
      .slice(0, 3)
      .map((n) => String(parseInt(n, 10)))
      .join('*');
  }
  if (nums && nums.length >= 2) {
    const n1 = parseInt(nums[0], 10);
    const n2 = parseInt(nums[1], 10);
    return n1 < n2 ? `${n1}*${n2}` : `${n2}*${n1}`;
  }
  return cleaned.replace(/\s+/g, '');
}

/** 두 규격이 실질적으로 동일한지 판정 (가로x세로 반대 순서 및 기호 차이 무시) */
export function matchesSpec(specA: string | null | undefined, specB: string | null | undefined): boolean {
  if (!specA || !specB) return false;
  const normA = normalizeSpec(specA);
  const normB = normalizeSpec(specB);
  return Boolean(normA && normB && normA === normB);
}

/** 제본 판형(A4/B5 등) 또는 규격 문자열 일치 검사 */
export function matchesJebonFormat(
  dbPlateLabel: string,
  dbPlateSize: string,
  docSpec: string,
  plateItemKeywords: PlateItemAliasMap = DEFAULT_PLATE_ITEM_ALIASES_JEBON
): boolean {
  const spec = String(docSpec || '').trim();
  if (!spec) return true; // 명세에 판형 없으면 판형 불일치로 보지 않음

  const specNorm = normalizeKo(spec);
  const labelNorm = normalizeKo(dbPlateLabel);
  const sizeNorm = normalizeKo(dbPlateSize);

  if (labelNorm && (specNorm === labelNorm || specNorm.includes(labelNorm) || labelNorm.includes(specNorm))) {
    return true;
  }
  if (sizeNorm && matchesSpec(dbPlateSize, spec)) return true;

  for (const [fullType, aliases] of Object.entries(plateItemKeywords || {})) {
    const allKeywords = [fullType, ...(aliases || [])].map(normalizeKo).filter(Boolean);
    const matchesDb = allKeywords.some(
      (kw) =>
        (labelNorm && (labelNorm.includes(kw) || kw.includes(labelNorm))) ||
        (sizeNorm && (sizeNorm.includes(kw) || kw.includes(sizeNorm)))
    );
    if (!matchesDb) continue;
    if (allKeywords.some((kw) => specNorm.includes(kw) || kw.includes(specNorm))) return true;
  }

  return false;
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

  // 제본 납품내역서: "인증종류-프로젝트명" — 하이픈이 첫 괄호보다 앞이면 하이픈 우선
  // 예: "녹색건축인증 평가서-일광 교육행복타운"
  // 예: "건축물제로에너지효율등급 평가서-(가칭)장안1초등학교" (괄호만 보면 '가칭'으로 오인식됨)
  const dashIdx = text.search(/[-–—]/);
  if (dashIdx > 0 && dashIdx < text.length - 1 && (firstOpen === -1 || dashIdx < firstOpen)) {
    const before = text.slice(0, dashIdx).replace(/\s+/g, ' ').trim();
    const after = text.slice(dashIdx + 1).replace(/\s+/g, ' ').trim();
    if (before && after) {
      return { title: before, projects: [after] };
    }
  }

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
  certTypeKeywords: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES,
  plateItemKeywords: PlateItemAliasMap = DEFAULT_PLATE_ITEM_ALIASES
): boolean {
  const docNorm = normalizeKo(docTitle);
  const dbCertNorm = normalizeKo(dbCertType);
  const dbPlateNorm = normalizeKo(dbPlateLabel);

  if (docNorm && dbCertNorm && (docNorm.includes(dbCertNorm) || dbCertNorm.includes(docNorm))) return true;
  if (docNorm && dbPlateNorm && (docNorm.includes(dbPlateNorm) || dbPlateNorm.includes(docNorm))) return true;

  // 1) 인증의 종류 키워드 사전 대조
  for (const [fullType, aliases] of Object.entries(certTypeKeywords)) {
    const allKeywords = [fullType, ...(aliases || [])].map(normalizeKo).filter(Boolean);
    const matchesDb = allKeywords.some(
      (kw) => dbCertNorm.includes(kw) || kw.includes(dbCertNorm)
    );
    if (matchesDb) {
      const matchesDoc = allKeywords.some((kw) => docNorm.includes(kw) || kw.includes(docNorm));
      if (matchesDoc) return true;
    }
  }

  // 2) 현판 품목 키워드 사전 대조
  for (const [fullType, aliases] of Object.entries(plateItemKeywords)) {
    const allKeywords = [fullType, ...(aliases || [])].map(normalizeKo).filter(Boolean);
    const matchesDb = allKeywords.some(
      (kw) => dbPlateNorm.includes(kw) || kw.includes(dbPlateNorm)
    );
    if (matchesDb) {
      const matchesDoc = allKeywords.some((kw) => docNorm.includes(kw) || kw.includes(docNorm));
      if (matchesDoc) return true;
    }
  }

  return false;
}

/** 명세표 행의 정산 반영 금액 — 제본/기타제작물: 청구 합계, 현판: 개당 단가 */
export function getStatementSettledPrice(
  row: ParsedStatementRow | null | undefined,
  category: string = 'SIGN'
): number {
  if (!row) return 0;
  const cat = String(category || '').toUpperCase();
  const useSupplyTotal = cat === 'JEBON' || cat === 'PRINT' || cat === 'OFFICE_SUPPLIES';
  if (useSupplyTotal) {
    if (row.supplyPrice > 0) return row.supplyPrice;
    if (row.unitPrice > 0 && row.qty > 0) return row.unitPrice * row.qty;
    return row.unitPrice || 0;
  }
  return row.unitPrice || (row.qty > 0 ? Math.round(row.supplyPrice / row.qty) : row.supplyPrice) || 0;
}

/** DB 매칭 건의 배치 합산용 금액 */
export function getItemBatchAmount(
  item: { docUnitPrice?: number; quantity?: number; category?: string },
  categoryHint: string = 'SIGN'
): number {
  const price = Number(item.docUnitPrice) || 0;
  const cat = String(item.category || categoryHint || '').toUpperCase();
  // 제본·기타제작물·사무문구: docUnitPrice = 최종(청구)금액
  if (cat === 'JEBON' || cat === 'PRINT' || cat === 'OFFICE_SUPPLIES') return price;
  return price * (item.quantity || 1); // 현판 docUnitPrice = 개당
}

/** 명세표 품목 제목을 인증 마스터(인증별 서식 기준) 정식 명칭으로 매핑 */
export function resolveCertMasterLabel(
  docTitle: string,
  certTypeKeywords: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES
): string | null {
  const docNorm = normalizeKo(docTitle);
  if (!docNorm) return null;

  let best: { label: string; score: number } | null = null;
  for (const [fullType, aliases] of Object.entries(certTypeKeywords || {})) {
    const allKeywords = [fullType, ...(aliases || [])].map(normalizeKo).filter(Boolean);
    for (const kw of allKeywords) {
      if (!kw) continue;
      if (docNorm === kw || docNorm.includes(kw) || kw.includes(docNorm)) {
        const score = kw.length + (docNorm === kw ? 1000 : docNorm.includes(kw) ? 100 : 0);
        if (!best || score > best.score) best = { label: fullType, score };
      }
    }
  }
  return best?.label || null;
}

/** 드롭다운/요약용 명세표 행 표시 문구 */
export function formatStatementRowLabel(
  row: ParsedStatementRow,
  certTypeKeywords?: CertTypeAliasMap,
  options: { preferMasterCert?: boolean; category?: string } = {}
): string {
  const master =
    options.preferMasterCert !== false
      ? resolveCertMasterLabel(row.categoryTitle, certTypeKeywords || {})
      : null;
  const certPart = master || row.categoryTitle || row.rawItem || '(품목)';
  const projectPart =
    (row.extractedProjects && row.extractedProjects[0]) ||
    '';
  const isJebon = String(options.category || '').toUpperCase() === 'JEBON';
  const isPrintLike =
    String(options.category || '').toUpperCase() === 'PRINT' ||
    String(options.category || '').toUpperCase() === 'OFFICE_SUPPLIES';
  // 제본·기타제작: 드롭다운에도 청구/합계 금액 표시 (단가 오인 방지)
  const unit = isJebon || isPrintLike
    ? row.supplyPrice ||
      (row.unitPrice > 0 && row.qty > 0 ? row.unitPrice * row.qty : row.unitPrice) ||
      0
    : row.unitPrice ||
      (row.qty > 0 ? Math.round(row.supplyPrice / row.qty) : row.supplyPrice) ||
      0;
  const specPart = row.spec ? ` ${row.spec}` : '';
  const name = projectPart
    ? `${certPart}${specPart} · ${projectPart}`
    : `${certPart}${specPart}`;
  return `${name} (₩${Number(unit).toLocaleString()})`;
}

/** 기타제작물 품명에서 (중)/(대)/가공 접미 제거 — 공통 품목명 비교용 */
export function stripPrintSizeToken(name: string): string {
  return String(name || '')
    .replace(/\s*가공\s*$/u, '')
    .replace(/[(（]?\s*(중|대|소)\s*[)）]?\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 명세표 대조에서 제외할 잡품목 여부 (현판 명세에 섞인 부속품 등) */
export function isExcludedStatementItem(
  categoryTitle: string,
  category: string = 'SIGN'
): boolean {
  const t = String(categoryTitle || '');
  const tNorm = normalizeKo(t);
  const cat = String(category || 'SIGN').toUpperCase();

  // 명함은 전 분류 제외
  if (t.includes('명함') || tNorm.includes('명함')) return true;

  // 기타제작·사무문구: 견적서 공정행(용지/인쇄/배송·가공 등)만 제외, 실제 주문 품목은 유지
  if (cat === 'PRINT' || cat === 'OFFICE_SUPPLIES') {
    return (
      tNorm.includes('배송비') ||
      tNorm.includes('박스포장') ||
      tNorm.includes('운임') ||
      tNorm === '디자인' ||
      tNorm === '용지' ||
      tNorm === '인쇄' ||
      tNorm === '코팅' ||
      tNorm === '후가공' ||
      tNorm === '포장' ||
      tNorm.includes('스노우') ||
      tNorm.includes('옵셋') ||
      tNorm.includes('무광') ||
      // "쇼핑백 가공" 등 공정행 — 품목 헤더(쇼핑백+규격)와 구분
      /(^|[^가-힣])가공$/.test(tNorm) ||
      tNorm.endsWith('가공')
    );
  }

  // 현판·제본 명세에 딸려 오는 잡품
  return (
    tNorm.includes('인증서용지') ||
    t.includes('봉투') ||
    tNorm.includes('상장케이스')
  );
}

/** 제본 신청 옵션/제목에서 순수 프로젝트(건물)명만 추출 */
export function resolveJebonProjectName(
  opts: Record<string, unknown> | null | undefined,
  fallbackTitle: string = ''
): string {
  const o = opts || {};
  const building = String(o.jebonBuildingName || o.coverName || '').trim();
  if (building) return building;

  const formTitle = String(o.jebonFormTitle || fallbackTitle || '').trim();
  if (!formTitle) return '';

  // 제목 자동생성: 프로젝트_단계_인증_일자 → 첫 구간이 프로젝트명
  if (formTitle.includes('_')) {
    const first = formTitle.split('_')[0]?.trim() || '';
    if (first && first !== '프로젝트명') return first;
  }

  return formTitle;
}

/**
 * 프로젝트명 유사도 점수 (0이면 불일치)
 * - strict(제본): 짧은 부분일치로 다른 건에 붙는 것 방지 (고강역 ⊂ 고강역월드메르디앙)
 */
export function scoreProjectNameMatch(
  dbProject: string,
  docProject: string,
  options: { strict?: boolean } = {}
): number {
  const dbNorm = normalizeKo(dbProject);
  const docNorm = normalizeKo(docProject);
  if (!dbNorm || !docNorm) return 0;

  if (dbNorm === docNorm) return 1000 + dbNorm.length;

  const shorter = Math.min(dbNorm.length, docNorm.length);
  const longer = Math.max(dbNorm.length, docNorm.length);
  const contained = dbNorm.includes(docNorm) || docNorm.includes(dbNorm);

  if (contained) {
    if (options.strict) {
      if (shorter < 4) return 0;
      if (shorter / longer < 0.5) return 0;
    }
    return 500 + shorter * 2 - (longer - shorter);
  }

  // 느슨한 3글자 퍼지(현판 OCR용). 제본(strict)에서는 사용하지 않음
  if (!options.strict && dbNorm.length >= 3 && docNorm.length >= 3) {
    for (let i = 0; i <= dbNorm.length - 3; i++) {
      const sub = dbNorm.slice(i, i + 3);
      if (docNorm.includes(sub)) return 100 + 3;
    }
  }

  return 0;
}

/** 프로젝트명 매칭 검사 (공백/특수문자 무시 부분일치) */
export function matchesProjectName(dbProject: string, docProject: string): boolean {
  return scoreProjectNameMatch(dbProject, docProject) > 0;
}

/** 전체 DB 신청건과 파싱된 명세표 행들 간의 N:1 집계 교차 검증 */
export function runProductionStatementMatch(
  dbItems: ProductionDbItem[],
  statementRows: ParsedStatementRow[],
  rulesOrAliasMap: ProductionStatementRules | CertTypeAliasMap = DEFAULT_PRODUCTION_RULES,
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
  // rules 정규화 (이전 certTypeAliases 단일 맵 인입 시 호환)
  let certKeywords: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES;
  let plateKeywords: PlateItemAliasMap = DEFAULT_PLATE_ITEM_ALIASES;

  if (rulesOrAliasMap && 'certTypeKeywords' in rulesOrAliasMap) {
    const rulesObj = rulesOrAliasMap as ProductionStatementRules;
    certKeywords = rulesObj.certTypeKeywords || DEFAULT_CERT_TYPE_ALIASES;
    plateKeywords = rulesObj.plateItemKeywords || DEFAULT_PLATE_ITEM_ALIASES;
  } else if (typeof rulesOrAliasMap === 'object' && rulesOrAliasMap !== null) {
    certKeywords = rulesOrAliasMap as CertTypeAliasMap;
  }

  const itemMatches: ItemMatchResult[] = [];
  const matchedDbIdsByRow: Record<number, string[]> = {};
  const sessionCategory = String(
    dbItems.find((i) => i.category)?.category || 'SIGN'
  ).toUpperCase();

  // 초기화
  statementRows.forEach((r) => {
    matchedDbIdsByRow[r.rawIndex] = [];
  });

  for (const item of dbItems) {
    // 1. 수기 지정(강제 매칭) 여부 우선 확인
    if (manualOverrides[item.id] !== undefined) {
      const override = manualOverrides[item.id];
      const targetRow = statementRows.find((r) => r.rawIndex === override.rowIndex);
      const unitPrice =
        override.unitPrice ??
        getStatementSettledPrice(targetRow, item.category);

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
        adminPriceSet: override.unitPrice != null,
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
      const itemCat = String(item.category || sessionCategory || '').toUpperCase();
      if (isExcludedStatementItem(row.categoryTitle, itemCat)) {
        continue;
      }

      const cat = itemCat;
      const isJebon = cat === 'JEBON';
      const isPrintLike = cat === 'PRINT' || cat === 'OFFICE_SUPPLIES';

      // 프로젝트명/품목명 체크
      // - 제본·현판: 괄호·하이픈 뒤 프로젝트
      // - 기타제작물: 하이픈 없는 "상장케이스"처럼 extractedProjects가 비면 categoryTitle 자체를 후보로 사용
      // - PRINT는 strict: "인증서" 공통 접두로 용지↔홀더가 붙지 않게
      let nameMatch = false;
      let matchedProject = '';
      let projectScore = 0;

      const docCandidates =
        row.extractedProjects.length > 0
          ? row.extractedProjects
          : isPrintLike
            ? [row.categoryTitle, row.rawItem].filter((s) => String(s || '').trim())
            : [];

      const dbNameCandidates = isPrintLike
        ? [item.plateLabel, item.title, item.projectName].filter((s) => String(s || '').trim())
        : [item.projectName];

      for (const dbName of dbNameCandidates) {
        for (const docProj of docCandidates) {
          let pScore = scoreProjectNameMatch(dbName, docProj, {
            strict: isJebon || isPrintLike,
          });
          // 기타제작: 쇼핑백(중) ↔ 쇼핑백 / 쇼핑백 가공 처럼 사이즈·공정 접미가 달라도 공통 품명 매칭
          if (pScore === 0 && isPrintLike) {
            const dbBase = stripPrintSizeToken(dbName);
            const docBase = stripPrintSizeToken(docProj);
            pScore = scoreProjectNameMatch(dbBase, docBase, { strict: false });
            if (pScore === 0) {
              const dbN = normalizeKo(dbBase);
              const docN = normalizeKo(docBase);
              if (
                dbN.length >= 3 &&
                docN.length >= 3 &&
                (dbN.includes(docN) || docN.includes(dbN))
              ) {
                pScore = 280;
              }
            }
          }
          // 규격이 같으면 강하게 가산 (중/대 쇼핑백 구분)
          if (
            pScore > 0 &&
            isPrintLike &&
            row.spec &&
            item.plateSize &&
            matchesSpec(item.plateSize, row.spec)
          ) {
            pScore += 800;
          }
          if (pScore > projectScore) {
            projectScore = pScore;
            nameMatch = true;
            matchedProject = docProj;
          }
        }
      }

      // 키워드 사전으로 품목 직접 매칭 (기타제작물)
      if (isPrintLike && !nameMatch) {
        const keywordHit = matchesCertOrPlateType(
          '',
          item.plateLabel || item.title,
          row.categoryTitle || row.rawItem,
          {},
          plateKeywords
        );
        if (keywordHit) {
          nameMatch = true;
          matchedProject = row.categoryTitle || row.rawItem;
          projectScore = 400;
          if (row.spec && item.plateSize && matchesSpec(item.plateSize, row.spec)) {
            projectScore += 800;
          }
        }
      }

      // 프로젝트명/품목명이 아예 안 맞으면 후보 제외
      if (!nameMatch) continue;

      // 소속 체크 — 기타제작물 명세의 "부서"열이 회사명(인증원)인 경우가 많아 느슨하게
      const deptMatch =
        isPrintLike ||
        !row.dept ||
        !item.deptName ||
        normalizeKo(row.dept).includes(normalizeKo(item.deptName)) ||
        normalizeKo(item.deptName).includes(normalizeKo(row.dept)) ||
        normalizeKo(row.dept) === normalizeKo('인증원');

      // 현판: 주물/일반 재질 · 제본: 판형 · 기타제작물: 규격 있으면 비교, 없으면 통과
      const materialMatch = isJebon
        ? matchesJebonFormat(item.plateLabel, item.plateSize, row.spec, plateKeywords)
        : isPrintLike
          ? !row.spec ||
            !item.plateSize ||
            matchesSpec(item.plateSize, row.spec) ||
            normalizeKo(row.spec).includes(normalizeKo(item.plateSize)) ||
            normalizeKo(item.plateSize).includes(normalizeKo(row.spec))
          : item.isJumul === row.isJumul;

      // 인증종류/품목 일치
      const certMatch = isPrintLike
        ? matchesCertOrPlateType(
            '',
            item.plateLabel || item.title,
            row.categoryTitle || row.rawItem,
            {},
            plateKeywords
          ) || nameMatch
        : matchesCertOrPlateType(
            item.certType,
            isJebon ? '' : item.plateLabel,
            row.categoryTitle,
            certKeywords,
            isJebon ? {} : plateKeywords
          );

      // 규격 일치 체크
      const specMatch = isJebon || isPrintLike
        ? materialMatch
        : !row.spec || !item.plateSize || matchesSpec(item.plateSize, row.spec);

      // 점수
      let score = projectScore;
      if (deptMatch) score += 30;
      if (materialMatch) score += 30;
      if (certMatch) score += isJebon ? 200 : isPrintLike ? 80 : 20;
      if (!isJebon && !isPrintLike && specMatch && row.spec && item.plateSize) score += 15;

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
      const cat = String(item.category || '').toUpperCase();
      const isJebon = cat === 'JEBON';
      const isPrintLike = cat === 'PRINT' || cat === 'OFFICE_SUPPLIES';
      // 프로젝트명 + (현판:재질 / 제본:판형 / 기타:품목) + 인증·품목 일치 시 풀매칭
      const isFullMatch = bestMatch.nameMatch && bestMatch.materialMatch && bestMatch.certMatch;

      const materialLabel = isJebon ? '판형' : isPrintLike ? '규격' : '재질(주물/일반)';
      const itemKindLabel = isJebon ? '인증종류' : isPrintLike ? '제작품목' : '인증/품목종류';

      itemMatches.push({
        ...item,
        matchedRowIndex: bestMatch.row.rawIndex,
        matchedRowTitle: bestMatch.row.categoryTitle,
        docProjectName: bestMatch.matchedProject,
        docUnitPrice: getStatementSettledPrice(bestMatch.row, item.category),
        nameMatch: bestMatch.nameMatch,
        deptMatch: bestMatch.deptMatch,
        certMatch: bestMatch.certMatch,
        materialMatch: bestMatch.materialMatch,
        matchStatus: isFullMatch ? 'match' : 'mismatch',
        adminOverride: false,
        adminPriceSet: false,
        resultNote: isFullMatch
          ? bestMatch.deptMatch
            ? isJebon
              ? '일치 (프로젝트명·인증·판형·소속 완벽 일치)'
              : isPrintLike
                ? '일치 (품목·수량 기준 일치)'
                : '일치 (프로젝트명·품목·재질·소속 완벽 일치)'
            : isJebon
              ? '일치 (프로젝트명·인증·판형 일치 / 명세표 소속 표기 상이)'
              : isPrintLike
                ? '일치 (품목 일치 / 명세표 소속 표기 상이)'
                : '일치 (프로젝트명·품목·재질 일치 / 명세표 소속 표기 상이)'
          : `불일치 (${[!bestMatch.materialMatch && materialLabel, !bestMatch.certMatch && itemKindLabel, !bestMatch.deptMatch && '소속'].filter(Boolean).join(', ')} 확인 필요)`,
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
        adminPriceSet: false,
        resultNote:
          String(item.category || '').toUpperCase() === 'PRINT' ||
          String(item.category || '').toUpperCase() === 'OFFICE_SUPPLIES'
            ? '명세표 내 일치하는 제작 품목을 찾지 못함 (수기 확인 필요)'
            : '명세표 내 일치하는 프로젝트명을 찾지 못함 (수기 확인 필요)',
      });
    }
  }

  // 그룹별 집계 요약 생성 (명함 등 제외한 현판/제작물 그룹)
  const productionGroups = statementRows.filter(
    (r) => !isExcludedStatementItem(r.categoryTitle, sessionCategory)
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
    (sum, m) => sum + getItemBatchAmount(m, m.category),
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

/** 엑셀 테이블에서 명세표 행 추출 (사용자 정의 칼럼 키워드 반영) */
export function extractProductionExcelRows(
  rows: any[][],
  columnHeaders: StatementColumnHeaderKeywords = DEFAULT_COLUMN_HEADERS
): ParsedStatementRow[] {
  let headerRow = -1;
  let found = {
    name: -1,
    spec: -1,
    project: -1,
    qty: -1,
    unitPrice: -1,
    price: -1,
    dept: -1,
  };

  const pickAliases = (configured: string[] | undefined, fallback: string[]) =>
    Array.isArray(configured) && configured.length > 0 ? configured : fallback;

  const colMap = {
    name: [
      ...pickAliases(columnHeaders.plateItem, []),
      ...pickAliases(columnHeaders.certType, []),
      // plateItem/certType이 비어 있을 때만 일반 품목 키워드 사용 (오탐 방지)
      ...(!columnHeaders.plateItem?.length && !columnHeaders.certType?.length
        ? ['품목', '품명', '내역', '항목', '원고명']
        : []),
    ],
    spec: pickAliases(columnHeaders.spec, ['규격', '사이즈', '크기', '판형']),
    project: pickAliases(columnHeaders.projectName, ['프로젝트명', '프로젝트', '건물명']),
    qty: pickAliases(columnHeaders.quantity, ['수량', '수 량', '부수']),
    unitPrice: pickAliases(columnHeaders.unitPrice, ['단가', '단 가']),
    // 단가 열이 없어도 공급가액/청구금액으로 헤더 인정
    price: pickAliases(columnHeaders.supplyPrice, ['공급가액', '공급가', '금액', '청구금액']),
    dept: pickAliases(columnHeaders.dept, ['소속', '조직', '비고', '센터', '부서']),
  };

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const rowLabels = (rows[r] || []).map((c) => String(c ?? '').trim());
    const mapped = {
      name: -1,
      spec: -1,
      project: -1,
      qty: -1,
      unitPrice: -1,
      price: -1,
      dept: -1,
    };

    (Object.keys(colMap) as (keyof typeof colMap)[]).forEach((key) => {
      const aliases = colMap[key] || [];
      if (aliases.length === 0) return;
      const idx = rowLabels.findIndex((l) =>
        aliases.some((a) => normalizeKo(l).includes(normalizeKo(a)))
      );
      if (idx >= 0) mapped[key] = idx;
    });

    // 품목열 + (수량 또는 공급가액/청구금액) → 헤더로 인정 (단가 열 없어도 OK)
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
    let item = String(row[found.name] ?? '').trim();
    if (!item || item.includes('합계') || item.includes('소계') || item === '계') continue;

    // 만약 프로젝트명 열이 별도로 있는 경우 합치기
    if (found.project >= 0 && found.project !== found.name) {
      const projText = String(row[found.project] ?? '').trim();
      if (projText && !item.includes('(') && !item.includes('（')) {
        item += ` (${projText})`;
      }
    }

    const spec = found.spec >= 0 ? String(row[found.spec] ?? '').trim() : '';
    const qty = found.qty >= 0 ? parseInt(String(row[found.qty] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    let unitPrice = found.unitPrice >= 0 ? parseInt(String(row[found.unitPrice] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    const supplyPrice = found.price >= 0 ? parseInt(String(row[found.price] ?? '').replace(/[^\d]/g, ''), 10) || 0 : 0;
    const dept = found.dept >= 0 ? String(row[found.dept] ?? '').trim() : '';

    // 제본/기타제작물 납품내역서처럼 단가 열 없이 청구금액만 있는 경우 단가 환산
    if (!unitPrice && supplyPrice > 0 && qty > 0) {
      unitPrice = Math.round(supplyPrice / qty);
    }

    // 수량·금액 모두 없으면 부서 소계/빈행으로 보고 스킵
    if (qty <= 0 && supplyPrice <= 0 && unitPrice <= 0) continue;

    results.push(parseStatementRow(item, spec, qty, unitPrice, supplyPrice, dept, results.length));
  }

  return results;
}
