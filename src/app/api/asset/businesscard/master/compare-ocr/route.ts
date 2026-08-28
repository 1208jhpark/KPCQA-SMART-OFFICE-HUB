import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import {
  applyStatementMatches,
  extractPdfStatementLines,
  normalizeStatementColMap,
  type StatementDbItem,
} from '@/lib/businesscard-statement-match';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/order';

export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const detailsStr = formData.get('batchDetails') as string;
    const colMapRaw = formData.get('colMap');
    let colMapParsed: unknown = {};
    if (typeof colMapRaw === 'string' && colMapRaw) {
      try { colMapParsed = JSON.parse(colMapRaw); } catch { colMapParsed = {}; }
    }
    const colMap = normalizeStatementColMap(colMapParsed);

    if (!file || !detailsStr) {
      return NextResponse.json({ error: '파일 또는 매칭 데이터가 없습니다.' }, { status: 400 });
    }

    const dbItems: StatementDbItem[] = JSON.parse(detailsStr);
    const logs: string[] = [
      `✅ PDF 수신. 제목줄(${colMap.name.join('/')} · ${colMap.qty.join('/')} · ${colMap.dept.join('/')} · ${colMap.price.join('/')})을 찾아 같은 행을 읽습니다.`,
    ];

    const arrayBuffer = await file.arrayBuffer();
    let parsedText = '';
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

    const knownDepts = Array.from(
      new Set(
        dbItems.flatMap((d) => [d.deptName, d.deptHead, d.dept]).filter((v): v is string => Boolean(v))
      )
    );
    const knownNames = dbItems.map((d) => d.name).filter(Boolean);
    const extracted = extractPdfStatementLines(parsedText, knownDepts, colMap, knownNames);
    const lines = extracted.lines;
    logs.push(...extracted.warnings.map((w) => `⚠️ ${w}`));
    logs.push(`📄 문서에서 명함 행 ${lines.length}건 인식`);
    lines.forEach((line) => {
      logs.push(
        `🔍 이름: ${line.name || '(미인식)'} / 수량: ${line.qty || 0}통 / 소속: ${line.dept || '(미인식)'} / 공급가액: ${line.price || 0}`
      );
    });

    const details = applyStatementMatches(dbItems, lines);
    const docTotalQty = details.reduce((sum, d) => sum + (d.docQty || 0), 0);
    const docTotalPrice = details.reduce((sum, d) => sum + (d.docPrice || 0), 0);
    details.forEach((d) => {
      if (d.matchStatus === 'match') {
        logs.push(`✅ ${d.name}: 이름·소속·수량 일치 · 공급가액 ₩${(d.docPrice || 0).toLocaleString()}`);
      } else {
        logs.push(`❌ ${d.name}: ${d.resultNote}`);
      }
    });

    return NextResponse.json({
      details,
      docTotalQty,
      docTotalPrice,
      logs,
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard compare-ocr]', error);
    return NextResponse.json(
      {
        error: 'PDF 내부 분석 중 오류가 발생했습니다.',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
