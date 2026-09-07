import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import {
  parseStatementRow,
  runProductionStatementMatch,
  type ParsedStatementRow,
  type ProductionDbItem,
  type CertTypeAliasMap,
  DEFAULT_CERT_TYPE_ALIASES,
} from '@/lib/production-statement-match';
import { authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/master/dashboard',
  '/asset/production/dept-master/archive',
  '/asset/production/master/archive',
];

/** PDF 텍스트에서 명세표 행 추출 (멀티라인 품목 및 규격·수량·단가 완벽 파싱) */
function extractPdfProductionStatementRows(rawText: string): {
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

  // 규격(400*300) + 수량 + 단가 + 공급가액 + 비고(센터/본부 등) 패턴
  // 예: "400*300 \t16 \t\135,000 \t\2,160,000 \t녹색건축인증센터"
  // 또는 "(녹색빌딩) 400*300 \t1 \t\230,000 \t\230,000 \t녹색건축인증센터"
  // 또는 "스텐현판(구제로빌딩) \t450*300 \t1 \t\120,000 \t\120,000 \t경영기획센터"
  const rowDataRegex =
    /([0-9]+\s*[*xX×]\s*[0-9]+)\s+(\d{1,5})\s+[\\₩￦]?\s*([\d,]+)\s+[\\₩￦]?\s*([\d,]+)(?:\s+([가-힣\s]+))?/;

  let currentItemLines: string[] = [];
  let headerFound = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 헤더 행 감지 전 메타 정보(사업자등록, 상호 등) 건너뛰기
    if (!headerFound) {
      if (
        line.includes('품') &&
        line.includes('목') &&
        (line.includes('규격') || line.includes('수량') || line.includes('단가'))
      ) {
        headerFound = true;
        logs.push('✅ 거래명세표 테이블 제목줄 감지 성공');
      }
      continue;
    }

    // 하단 합계 라인, 페이지 번호, 단순 월 라인 건너뛰기
    if (line.includes('계 \t\\') || line.includes('합계') || line.includes('of 2') || line.includes('of 3')) {
      continue;
    }
    if (/^\d{1,2}월$/.test(line)) {
      continue;
    }

    const match = line.match(rowDataRegex);
    if (match && match.index !== undefined) {
      const lineBeforeSpec = line.slice(0, match.index).trim();
      if (lineBeforeSpec) {
        currentItemLines.push(lineBeforeSpec);
      }

      const rawItem = currentItemLines.join(' ').replace(/\s+/g, ' ').trim();
      const spec = match[1].replace(/\s+/g, '');
      const qty = parseInt(match[2], 10) || 0;
      const unitPrice = parseInt(match[3].replace(/[^\d]/g, ''), 10) || 0;
      const supplyPrice = parseInt(match[4].replace(/[^\d]/g, ''), 10) || 0;
      const dept = (match[5] || '').trim();

      if (rawItem || qty > 0 || supplyPrice > 0) {
        const parsed = parseStatementRow(
          rawItem,
          spec,
          qty,
          unitPrice,
          supplyPrice,
          dept,
          rows.length
        );
        rows.push(parsed);
        logs.push(
          `🔍 [행 ${rows.length}] ${parsed.categoryTitle} (${parsed.extractedProjects.length}개 프로젝트) | 규격: ${spec} | 수량: ${qty} | 단가: ₩${unitPrice.toLocaleString()} | 공급가: ₩${supplyPrice.toLocaleString()} | 비고: ${dept}`
        );
      }

      currentItemLines = [];
    } else {
      currentItemLines.push(line);
    }
  }

  // 만약 헤더 플래그로 인해 누락되었거나 특이한 단일 테이블인 경우 2차 백업 스캔
  if (rows.length === 0) {
    logs.push('⚠️ 기본 테이블 파싱 미검출. 전체 라인 다이렉트 패턴 스캔을 시도합니다.');
    currentItemLines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.includes('거래명세표') || line.includes('한국생산성') || line.includes('공급자')) continue;

      const match = line.match(rowDataRegex);
      if (match && match.index !== undefined) {
        const lineBeforeSpec = line.slice(0, match.index).trim();
        if (lineBeforeSpec) currentItemLines.push(lineBeforeSpec);

        const rawItem = currentItemLines.join(' ').replace(/\s+/g, ' ').trim();
        const spec = match[1].replace(/\s+/g, '');
        const qty = parseInt(match[2], 10) || 0;
        const unitPrice = parseInt(match[3].replace(/[^\d]/g, ''), 10) || 0;
        const supplyPrice = parseInt(match[4].replace(/[^\d]/g, ''), 10) || 0;
        const dept = (match[5] || '').trim();

        const parsed = parseStatementRow(
          rawItem,
          spec,
          qty,
          unitPrice,
          supplyPrice,
          dept,
          rows.length
        );
        rows.push(parsed);
        currentItemLines = [];
      } else {
        currentItemLines.push(line);
      }
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

    let aliasMap: CertTypeAliasMap = DEFAULT_CERT_TYPE_ALIASES;
    if (aliasMapRaw) {
      try {
        aliasMap = JSON.parse(aliasMapRaw);
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

    const extracted = extractPdfProductionStatementRows(parsedText);
    logs.push(...extracted.logs);

    // DB 항목과의 교차 검증 매칭 수행
    const matchResult = runProductionStatementMatch(dbItems, extracted.rows, aliasMap);

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
