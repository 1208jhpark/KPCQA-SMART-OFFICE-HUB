import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import {
  parseStatementRow,
  runProductionStatementMatch,
  type ParsedStatementRow,
  type ProductionDbItem,
  type ProductionStatementRules,
  type StatementColumnHeaderKeywords,
  DEFAULT_PRODUCTION_RULES,
  normalizeKo,
} from '@/lib/production-statement-match';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/master/dashboard',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
  '/asset/production/master/archive',
];

const QTY_UNIT_TOKEN = String.raw`(?:개|장|부|식|매|통|권|세트|BOX|EA|ea|벌|본)?`;

/** 합계/배송비/단위 토큰 등 — 품목으로 쓰지 않음 (공백 허용) */
const SKIP_ITEM_RE =
  /^(배\s*송\s*비|절\s*사|부\s*가\s*세|소\s*계|합\s*계|공\s*급\s*가\s*액|단\s*가|수\s*량|단\s*위|비\s*고|여\s*백|이\s*하|견\s*적|수\s*신|유\s*효|결\s*제|인\s*도|개|장|부|식|매|원|계|[₩￦\\])$/;

const JUNK_ITEM_RE =
  /^(개|장|부|식|매|원|계|금|액|세|합|[₩￦\\]|VAT|vat)$/i;

function isPlausiblePdfItemName(rawItem: string): boolean {
  const name = String(rawItem || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) return false;
  if (JUNK_ITEM_RE.test(name)) return false;
  if (SKIP_ITEM_RE.test(name)) return false;
  if (name.includes('합계') || name.includes('공급가액') || name.includes('세액')) return false;
  // 금액/통화 조각만 있는 경우
  if (/^[₩￦\\]?\s*[\d,.\s원]+$/.test(name)) return false;
  // 한글 품명 최소 1자 (견적서·명세표는 한글 품목 전제)
  if (!/[가-힣]{2,}/.test(name)) return false;
  return true;
}

/** PDF 한 줄에서 명세표/견적 데이터행 파싱 */
function tryParsePdfDataLine(line: string): {
  rawItem: string;
  spec: string;
  qty: number;
  unitPrice: number;
  supplyPrice: number;
  dept: string;
} | null {
  const cleaned = String(line || '')
    .replace(/\t+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (SKIP_ITEM_RE.test(cleaned)) return null;
  if (cleaned.includes('이하') && cleaned.includes('여백')) return null;
  // 견적서 총액 한글 표기 등
  if (/원整|원정|일금|VAT\s*포함/i.test(cleaned) && /[₩￦]/.test(cleaned)) return null;

  // 선행 행번호(No) 제거용 공통 접두
  const stripNo = (s: string) => s.replace(/^\d{1,3}[.)]?\s+/, '').trim();

  // 1) 숫자 규격: 400*300 + 수량 + (단위) + 단가 + 공급가액 + 비고
  const numericSpec = new RegExp(
    String.raw`^(?:\d{1,3}[.)]?\s+)?(.*?)\s+([0-9]+\s*[*xX×.]\s*[0-9]+)\s+(\d{1,6})\s*${QTY_UNIT_TOKEN}\s*[\\₩￦]?\s*([\d,]+)\s*[\\₩￦]?\s*([\d,]+)(?:\s+(.+))?$`
  );
  // 2) 문자 규격: A4 / B5 / 16절 + 수량 + (단위) + 단가 + 공급가액
  const textSpec = new RegExp(
    String.raw`^(?:\d{1,3}[.)]?\s+)?(.*?)\s+([A-Za-z][A-Za-z0-9]*|[0-9]+절)\s+(\d{1,6})\s*${QTY_UNIT_TOKEN}\s*[\\₩￦]?\s*([\d,]+)\s*[\\₩￦]?\s*([\d,]+)(?:\s+(.+))?$`
  );
  // 3) 규격 없음: 품목 + 수량 + (개/장) + 단가 + 금액/공급가액 + 비고
  //    예: "1 경조사봉투인쇄 200 장 580 116,000" / "상장 케이스 600 개 2,724 1,634,400"
  const noSpec = new RegExp(
    String.raw`^(?:\d{1,3}[.)]?\s+)?(.+?)\s+(\d{1,6})\s*${QTY_UNIT_TOKEN}\s*[\\₩￦]?\s*([\d,]+)\s*[\\₩￦]?\s*([\d,]+)(?:\s+(.+))?$`
  );

  let m = cleaned.match(numericSpec);
  if (m) {
    const rawItem = stripNo((m[1] || '').trim());
    if (!isPlausiblePdfItemName(rawItem)) return null;
    return {
      rawItem,
      spec: m[2].replace(/\s+/g, '').replace(/[.xX×]/g, '*'),
      qty: parseInt(m[3], 10) || 0,
      unitPrice: parseInt(m[4].replace(/[^\d]/g, ''), 10) || 0,
      supplyPrice: parseInt(m[5].replace(/[^\d]/g, ''), 10) || 0,
      dept: (m[6] || '').trim(),
    };
  }

  m = cleaned.match(textSpec);
  if (m) {
    const rawItem = stripNo((m[1] || '').trim());
    if (!isPlausiblePdfItemName(rawItem)) return null;
    return {
      rawItem,
      spec: m[2].trim(),
      qty: parseInt(m[3], 10) || 0,
      unitPrice: parseInt(m[4].replace(/[^\d]/g, ''), 10) || 0,
      supplyPrice: parseInt(m[5].replace(/[^\d]/g, ''), 10) || 0,
      dept: (m[6] || '').trim(),
    };
  }

  m = cleaned.match(noSpec);
  if (m) {
    const qty = parseInt(m[2], 10) || 0;
    const unitPrice = parseInt(m[3].replace(/[^\d]/g, ''), 10) || 0;
    const supplyPrice = parseInt(m[4].replace(/[^\d]/g, ''), 10) || 0;
    const rawItem = stripNo((m[1] || '').trim());
    if (!isPlausiblePdfItemName(rawItem)) return null;
    if (qty <= 0 && supplyPrice <= 0) return null;
    // 오탐 방지: 단가·공급가가 비정상이면 스킵 (예: 페이지번호 조각, 깨진 견적 칸)
    if (unitPrice > 0 && supplyPrice > 0 && supplyPrice < unitPrice && qty > 1) return null;
    if (supplyPrice > 0 && supplyPrice < 100 && qty >= 10) return null;
    // 단가×수량과 공급가가 크게 어긋나면 스킵 (깨진 텍스트 레이어)
    if (unitPrice >= 50 && supplyPrice >= 100 && qty >= 1) {
      const expected = unitPrice * qty;
      if (Math.abs(expected - supplyPrice) > Math.max(expected * 0.15, 500)) return null;
    }
    return {
      rawItem,
      spec: '',
      qty,
      unitPrice,
      supplyPrice,
      dept: (m[5] || '').trim(),
    };
  }

  return null;
}

/**
 * 견적서처럼 텍스트 레이어가 뒤섞인 PDF 폴백
 * 예: "인증원 상장케이스 / 600개 / 제작 및 발송" + 흩어진 단가·공급가액
 */
function extractJumbledQuoteRows(
  rawText: string,
  logs: string[]
): ReturnType<typeof parseStatementRow>[] {
  const flat = String(rawText || '')
    .replace(/\t+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return [];

  const results: ReturnType<typeof parseStatementRow>[] = [];
  const seen = new Set<string>();

  const cleanQuoteItemName = (rawItem: string) =>
    String(rawItem || '')
      // 앞쪽에 붙은 금액 조각 ("1,839,180원 인증원 상장케이스" / "원 인증원 …")
      .replace(/^[\d,.\s₩￦\\]+/u, '')
      .replace(/^원\s*/u, '')
      .replace(/^인증원\s*/u, '')
      .replace(/\s*제작\s*및\s*발송.*$/u, '')
      .replace(/\s+/g, ' ')
      .trim();

  const resolveMoneyForQty = (qty: number, scope: string) => {
    let unitPrice = 0;
    let supplyPrice = 0;

    // 라벨이 있는 공급가액 우선
    const labeled = scope.match(/공급\s*가\s*액\s*[^\d]{0,12}(\d{1,3}(?:,\d{3})+|\d{4,8})/);
    if (labeled) {
      const s = parseInt(labeled[1].replace(/,/g, ''), 10) || 0;
      if (s > qty) {
        supplyPrice = s;
        if (s % qty === 0) unitPrice = s / qty;
      }
    }

    const moneyNums = Array.from(scope.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,8})/g))
      .map((x) => parseInt(x[1].replace(/,/g, ''), 10))
      .filter((n) => Number.isFinite(n) && n >= 100);

    if (!supplyPrice) {
      for (const n of moneyNums) {
        if (n <= qty) continue;
        if (n % qty === 0) {
          const u = n / qty;
          if (u >= 50 && u <= 5_000_000) {
            supplyPrice = n;
            unitPrice = u;
            break;
          }
        }
      }
    }

    // 절사 등으로 딱 안 나누어질 때: 단가 후보 × 수량 ≈ 공급가
    if (!unitPrice || !supplyPrice) {
      for (let i = 0; i < moneyNums.length; i++) {
        for (let j = 0; j < moneyNums.length; j++) {
          if (i === j) continue;
          const u = moneyNums[i];
          const s = moneyNums[j];
          if (u < 50 || s <= u) continue;
          if (Math.abs(u * qty - s) <= Math.max(qty, 50)) {
            unitPrice = u;
            supplyPrice = s;
            break;
          }
        }
        if (unitPrice && supplyPrice) break;
      }
    }

    return { unitPrice, supplyPrice };
  };

  const pushUnique = (
    rawItem: string,
    qty: number,
    unitPrice: number,
    supplyPrice: number,
    dept: string,
    note: string
  ) => {
    const name = cleanQuoteItemName(rawItem);
    if (!name || qty <= 0) return;
    if (!isPlausiblePdfItemName(name)) return;
    if (name.includes('배송')) return;
    const key = `${normalizeKo(name)}|${qty}|${supplyPrice || unitPrice}`;
    if (seen.has(key)) return;
    seen.add(key);

    let finalUnit = unitPrice;
    let finalSupply = supplyPrice;
    if (!finalSupply && finalUnit > 0 && qty > 0) finalSupply = finalUnit * qty;
    if (!finalUnit && finalSupply > 0 && qty > 0) {
      finalUnit = Math.round(finalSupply / qty);
    }

    const parsed = parseStatementRow(name, '', qty, finalUnit, finalSupply, dept, results.length);
    results.push(parsed);
    logs.push(
      `🧩 [견적 폴백] ${note} → ${parsed.categoryTitle} | 수량 ${qty} | 단가 ₩${finalUnit.toLocaleString()} | 공급가 ₩${finalSupply.toLocaleString()}`
    );
  };

  // 1) 제목형: 알려진 품목 우선, 그다음 한글로 시작하는 일반 품목
  //    금액 꼬리("180원 …")가 품명에 붙지 않도록 한글 시작 + 정리
  const titlePatterns = [
    /((?:상장\s*케이스|인증서\s*용지|인증서\s*홀더|경조사봉투[가-힣]*))\s*\/\s*(\d{1,6})\s*개/g,
    /(?:^|[^가-힣0-9])((?:인증원\s+)?(?!원\b)[가-힣]{2,}[가-힣A-Za-z0-9() ·_\-]{0,34}?)\s*\/\s*(\d{1,6})\s*개/g,
  ];
  for (const re of titlePatterns) {
    for (const m of flat.matchAll(re)) {
      const name = (m[1] || '').trim();
      const qty = parseInt(m[2], 10) || 0;
      if (!name || qty <= 0) continue;
      const { unitPrice, supplyPrice } = resolveMoneyForQty(qty, flat);
      pushUnique(name, qty, unitPrice, supplyPrice, '', '제목(품목/수량)');
    }
  }

  // 2) 단독 품목행 + 근처 수량(N개 또는 숫자+장/개)
  const itemLineRe =
    /(?:^|\s)((?:상장\s*케이스|인증서\s*용지|인증서\s*홀더|경조사봉투[가-힣]*|컬러대봉투[가-힣()]*|쇼핑백[가-힣()]*))(?:\s|$)/g;
  for (const m of flat.matchAll(itemLineRe)) {
    const name = (m[1] || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    // 이미 제목에서 잡혔으면 스킵
    if ([...seen].some((k) => k.startsWith(normalizeKo(name) + '|'))) continue;

    const around = flat.slice(Math.max(0, (m.index || 0) - 40), (m.index || 0) + name.length + 80);
    const qtyM =
      around.match(/(\d{1,6})\s*개/) ||
      around.match(/(\d{1,6})\s*장/) ||
      around.match(/수량\s*(\d{1,6})/);
    const qty = qtyM ? parseInt(qtyM[1], 10) || 0 : 0;
    if (qty <= 0) continue;

    const { unitPrice, supplyPrice } = resolveMoneyForQty(qty, around.length > 20 ? around : flat);
    pushUnique(name, qty, unitPrice, supplyPrice, '', '품목키워드+수량');
  }

  return results;
}

/**
 * 한생 쇼핑백 견적 등: "쇼핑백 230*70*320 - 2,000부"
 * - 공정행(쇼핑백 가공)이 아니라 품목+규격 헤더를 품목으로 사용
 * - 금액은 면 단위 ₩/￦ 최종 합계 우선 (합계가 여러 줄일 때)
 */
function extractProductSpecQtyRows(
  rawText: string,
  logs: string[]
): ReturnType<typeof parseStatementRow>[] {
  const pages = String(rawText || '').split(/--\s*\d+\s*of\s*\d+\s*--/i);
  const results: ReturnType<typeof parseStatementRow>[] = [];
  const seen = new Set<string>();
  const titleRe =
    /([가-힣A-Za-z()]+)\s+(\d+\s*[*xX×.]\s*\d+(?:\s*[*xX×.]\s*\d+)?)\s*[-–—]?\s*([\d,]+)\s*부/g;

  const extractPageGrandTotal = (flat: string): number => {
    // 1) 통화기호 붙은 합계 (견적서 하단 최종금액) 우선
    const currencyTotals = Array.from(flat.matchAll(/[₩￦]\s*([\d,]{4,})/g))
      .map((x) => parseInt(String(x[1] || '').replace(/,/g, ''), 10) || 0)
      .filter((n) => n >= 1_000);
    if (currencyTotals.length > 0) return Math.max(...currencyTotals);

    // 2) "합계" 라벨 금액들 중 가장 큰 값 (소계·부가세보다 큰 최종합)
    const labeled = Array.from(flat.matchAll(/합\s*계[^\d₩￦]{0,24}([\d,]{4,})/g))
      .map((x) => parseInt(String(x[1] || '').replace(/,/g, ''), 10) || 0)
      .filter((n) => n >= 1_000);
    if (labeled.length > 0) return Math.max(...labeled);

    return 0;
  };

  for (const page of pages) {
    const flat = page.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    const pageTotal = extractPageGrandTotal(flat);

    for (const m of flat.matchAll(titleRe)) {
      const name = String(m[1] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const spec = String(m[2] || '')
        .replace(/\s+/g, '')
        .replace(/[.xX×]/g, '*');
      const qty = parseInt(String(m[3] || '').replace(/,/g, ''), 10) || 0;
      if (!name || !spec || qty <= 0) continue;
      if (/디자인|용지|인쇄|코팅|후가공|포장|운임|배송|옵셋|스노우|무광|가공/.test(name)) continue;
      if (!isPlausiblePdfItemName(name)) continue;

      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const processRe = new RegExp(
        esc + String.raw`\s*가공\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)`
      );
      const pm = flat.match(processRe);
      let processUnit = 0;
      let processSupply = 0;
      if (pm) {
        processUnit = parseInt(String(pm[2] || '').replace(/,/g, ''), 10) || 0;
        processSupply = parseInt(String(pm[3] || '').replace(/,/g, ''), 10) || 0;
      }

      // 정산 금액: 면 최종합계(₩) > 가공 공급가 > 단가×수량
      let supplyPrice = pageTotal || processSupply;
      let unitPrice = 0;
      if (supplyPrice > 0 && qty > 0) unitPrice = Math.round(supplyPrice / qty);
      else if (processUnit > 0) {
        unitPrice = processUnit;
        supplyPrice = processUnit * qty;
      }

      const key = `${normalizeKo(name)}|${normalizeKo(spec)}|${qty}|${supplyPrice || unitPrice}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const parsed = parseStatementRow(name, spec, qty, unitPrice, supplyPrice, '', results.length);
      results.push(parsed);
      logs.push(
        `🧩 [규격견적] ${parsed.categoryTitle} | 규격 ${spec} | 수량 ${qty}부 | 단가 ₩${unitPrice.toLocaleString()} | 합계 ₩${supplyPrice.toLocaleString()}${pageTotal ? ' (면 최종합계)' : processSupply ? ' (가공행)' : ''}`
      );
    }
  }

  return results;
}

/** PDF 텍스트에서 명세표 행 추출 (사용자 정의 칼럼 키워드 지원) */
function extractPdfProductionStatementRows(
  rawText: string,
  columnHeaders: StatementColumnHeaderKeywords = DEFAULT_PRODUCTION_RULES.columnHeaders
): {
  rows: ParsedStatementRow[];
  logs: string[];
} {
  const text = String(rawText || '');
  const logs: string[] = [];
  const rows: ParsedStatementRow[] = [];

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  logs.push(`📄 문서 텍스트 레이어 인식: 총 ${rawLines.length}개 라인`);

  let currentItemLines: string[] = [];
  let headerFound = false;

  // 제목행 판별용 키워드 합산
  const headerKeywords = [
    ...(columnHeaders.certType || []),
    ...(columnHeaders.plateItem || []),
    ...(columnHeaders.spec || []),
    ...(columnHeaders.quantity || []),
    ...(columnHeaders.unitPrice || []),
    '품목',
    '품명',
    '규격',
    '수량',
    '단가',
    '금액',
  ].map(normalizeKo);

  const pushParsed = (
    parsedLine: NonNullable<ReturnType<typeof tryParsePdfDataLine>>,
    prefixLines: string[]
  ) => {
    let rawItem = parsedLine.rawItem;
    if (!rawItem && prefixLines.length > 0) {
      rawItem = prefixLines.join(' ').replace(/\s+/g, ' ').trim();
    } else if (prefixLines.length > 0 && rawItem) {
      const prefix = prefixLines.join(' ').replace(/\s+/g, ' ').trim();
      if (prefix && !normalizeKo(rawItem).includes(normalizeKo(prefix))) {
        rawItem = `${prefix} ${rawItem}`.replace(/\s+/g, ' ').trim();
      }
    }
    if (!rawItem && parsedLine.qty <= 0 && parsedLine.supplyPrice <= 0) return;
    if (rawItem && !isPlausiblePdfItemName(rawItem)) return;

    const parsed = parseStatementRow(
      rawItem,
      parsedLine.spec,
      parsedLine.qty,
      parsedLine.unitPrice,
      parsedLine.supplyPrice,
      parsedLine.dept,
      rows.length
    );
    rows.push(parsed);
    logs.push(
      `🔍 [행 ${rows.length}] ${parsed.categoryTitle} (${parsed.extractedProjects.length}개 프로젝트) | 규격: ${parsedLine.spec || '-'} | 수량: ${parsedLine.qty} | 단가: ₩${parsedLine.unitPrice.toLocaleString()} | 공급가: ₩${parsedLine.supplyPrice.toLocaleString()} | 비고: ${parsedLine.dept || '-'}`
    );
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const normLine = normalizeKo(line);

    if (!headerFound) {
      const matchCount = headerKeywords.filter((k) => k && normLine.includes(k)).length;
      if (matchCount >= 2) {
        headerFound = true;
        logs.push(`✅ 거래명세표 제목행 감지 성공: "${line}"`);
        continue;
      }
      continue;
    }

    if (
      line.includes('계 \t\\') ||
      /^\s*계\s*$/.test(line) ||
      /합\s*계/.test(line) ||
      /소\s*계/.test(line) ||
      /부\s*가\s*세/.test(line) ||
      /절\s*사/.test(line) ||
      line.includes('이하') ||
      line.includes('of 2') ||
      line.includes('of 3') ||
      line.includes('of 1')
    ) {
      continue;
    }
    if (/^\d{1,2}월$/.test(line)) continue;

    const parsedLine = tryParsePdfDataLine(line);
    if (parsedLine) {
      pushParsed(parsedLine, currentItemLines);
      currentItemLines = [];
    } else {
      currentItemLines.push(line);
    }
  }

  // 2차: 헤더 없이 전체 라인 스캔
  if (rows.length === 0) {
    logs.push('⚠️ 기본 테이블 파싱 미검출. 전체 라인 다이렉트 패턴 스캔을 시도합니다.');
    currentItemLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (
        line.includes('거래명세표') ||
        line.includes('한국생산성') ||
        line.includes('공급자') ||
        /합\s*계/.test(line) ||
        /부\s*가\s*세/.test(line) ||
        /절\s*사/.test(line) ||
        /소\s*계/.test(line) ||
        /^\s*계\s*$/.test(line)
      ) {
        continue;
      }

      const parsedLine = tryParsePdfDataLine(line);
      if (parsedLine) {
        pushParsed(parsedLine, currentItemLines);
        currentItemLines = [];
      } else {
        currentItemLines.push(line);
      }
    }
  }

  // 3차: 견적서처럼 필드가 흩어진 PDF (한생 상장케이스 등)
  const flatHint = text.replace(/\s+/g, ' ');
  const hasTitleQty = /\/\s*\d{1,6}\s*개/.test(flatHint);
  const hasUsefulRow = rows.some((r) => r.qty >= 10 && (r.supplyPrice >= 1000 || r.unitPrice >= 50));
  if (rows.length === 0 || (hasTitleQty && !hasUsefulRow)) {
    if (rows.length > 0) {
      logs.push('⚠️ 인식 행이 부정확해 보입니다. 견적서 폴백으로 재시도합니다.');
      rows.length = 0;
    } else {
      logs.push('⚠️ 라인 파싱 실패. 견적서(제목/수량 분산) 폴백을 시도합니다.');
    }
    const fallback = extractJumbledQuoteRows(text, logs);
    for (const row of fallback) {
      rows.push({ ...row, rawIndex: rows.length });
    }
  }

  // 4차: "쇼핑백 230*70*320 - 2,000부" 형 규격 견적 — 있으면 공정행보다 항상 우선
  const productSpecRows = extractProductSpecQtyRows(text, logs);
  if (productSpecRows.length > 0) {
    logs.push(
      `⚠️ 품목+규격+부수 견적 패턴 ${productSpecRows.length}건 감지. 규격 헤더·면 합계 기준으로 교체합니다.`
    );
    rows.length = 0;
    for (const row of productSpecRows) {
      rows.push({ ...row, rawIndex: rows.length });
    }
  }

  logs.push(`📊 파싱 완료: 총 ${rows.length}개 행 인식됨`);
  return { rows, logs };
}

export async function POST(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const dbItemsStr = formData.get('dbItems') as string;
    const rulesRaw = formData.get('rules') as string;
    const aliasMapRaw = formData.get('aliasMap') as string;

    if (!file) {
      return NextResponse.json({ error: '분석할 파일이 없습니다.' }, { status: 400 });
    }

    let dbItems: ProductionDbItem[] = [];
    if (dbItemsStr) {
      try {
        dbItems = JSON.parse(dbItemsStr);
      } catch {}
    }

    let rules: ProductionStatementRules = DEFAULT_PRODUCTION_RULES;
    if (rulesRaw) {
      try {
        rules = {
          ...DEFAULT_PRODUCTION_RULES,
          ...JSON.parse(rulesRaw),
        };
      } catch {}
    } else if (aliasMapRaw) {
      // 레거시 aliasMap 지원
      try {
        rules = {
          ...DEFAULT_PRODUCTION_RULES,
          certTypeKeywords: JSON.parse(aliasMapRaw),
        };
      } catch {}
    }

    const arrayBuffer = await file.arrayBuffer();
    let parsedText = '';
    const logs: string[] = [`📄 파일명: ${file.name} (용량: ${(file.size / 1024).toFixed(1)} KB)`];

    try {
      const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
      const result = await parser.getText();
      parsedText = result.text || '';
      await parser.destroy();
      logs.push('✅ PDF 텍스트 레이어 추출 성공.');
    } catch (parseError: any) {
      logs.push(`❌ PDF 텍스트 추출 실패: ${parseError.message}`);
      throw parseError;
    }

    const extracted = extractPdfProductionStatementRows(parsedText, rules.columnHeaders);
    logs.push(...extracted.logs);

    // DB 항목과의 교차 검증 매칭 수행
    const matchResult = runProductionStatementMatch(dbItems, extracted.rows, rules);

    const matchedCount = matchResult.itemMatches.filter((m) => m.matchStatus === 'match').length;
    logs.push(`🎯 매칭 결과: DB 총 ${dbItems.length}건 중 ${matchedCount}건 일치`);
    if (matchResult.allMatched) {
      logs.push('🎉 모든 품목과 수량, 단가가 완벽하게 일치합니다.');
    } else {
      logs.push('⚠️ 일부 항목에 확인 또는 수동 확인이 필요합니다.');
    }

    return NextResponse.json({
      success: true,
      statementRows: extracted.rows,
      itemMatches: matchResult.itemMatches,
      groupSummaries: matchResult.groupSummaries,
      totalDocPrice: matchResult.totalDocPrice,
      matchedBatchDocPrice: matchResult.matchedBatchDocPrice,
      totalDbCount: matchResult.totalDbCount,
      allMatched: matchResult.allMatched,
      unmatchedRows: matchResult.unmatchedRows,
      logs,
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[Production OCR Compare Error]:', error);
    return NextResponse.json(
      { error: error.message || '문서 분석 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
