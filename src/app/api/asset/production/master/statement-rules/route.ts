import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  getDefaultRulesForCategory,
  migrateLegacyZebCertKeywords,
  type ProductionStatementRules,
} from '@/lib/production-statement-match';

export const dynamic = 'force-dynamic';

const READ_PATHS = [
  '/asset/production/master/dashboard',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
  '/asset/production/master/archive',
];

/** 매칭 규칙 저장 — 마스터 대시보드 Edit만 */
const WRITE_PATHS = ['/asset/production/master/dashboard'];

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'production-statement');

function getRulesFilePath(category: string) {
  const safeCat = String(category || 'SIGN').trim().toUpperCase() || 'SIGN';
  return path.join(UPLOAD_DIR, `matching-rules_${safeCat}.json`);
}

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {}
}

async function getStoredRules(category: string = 'SIGN'): Promise<ProductionStatementRules> {
  const filePath = getRulesFilePath(category);
  const legacyFilePath = path.join(UPLOAD_DIR, 'matching-rules.json');
  const defaults = getDefaultRulesForCategory(category);

  try {
    let raw = '';
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      // 카테고리별 파일이 없고 SIGN인 경우 레거시 파일 확인
      if (category.toUpperCase() === 'SIGN') {
        raw = await fs.readFile(legacyFilePath, 'utf-8');
      }
    }

    if (!raw) return defaults;

    const parsed = JSON.parse(raw);
    const merged: ProductionStatementRules = {
      columnHeaders: {
        ...defaults.columnHeaders,
        ...(parsed.columnHeaders || {}),
      },
      certTypeKeywords:
        parsed.certTypeKeywords !== undefined
          ? parsed.certTypeKeywords
          : defaults.certTypeKeywords,
      plateItemKeywords:
        parsed.plateItemKeywords !== undefined
          ? parsed.plateItemKeywords
          : defaults.plateItemKeywords,
    };
    return migrateLegacyZebCertKeywords(merged, category);
  } catch {
    return defaults;
  }
}

/**
 * [GET] 명세표 매칭 규칙 및 칼럼 키워드 설정 조회 (카테고리별: ?category=SIGN 등)
 */
export async function GET(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || 'SIGN';

    const rules = await getStoredRules(category);

    // (구)/(통합) 제로에너지 키가 남아 있으면 통합본으로 파일 갱신
    const hasLegacyZeb = Object.keys(rules.certTypeKeywords || {}).some(
      (k) => /\(구\)\s*제로에너지/.test(k) || /\(통합\)\s*제로에너지/.test(k)
    );
    // migrate 후엔 레거시 키가 없어지므로, 원본 파일에 레거시가 있었는지 별도 확인
    try {
      const filePath = getRulesFilePath(category);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const rawHasLegacy = Object.keys(parsed.certTypeKeywords || {}).some(
        (k: string) => /\(구\)\s*제로에너지/.test(k) || /\(통합\)\s*제로에너지/.test(k)
      );
      if (rawHasLegacy || hasLegacyZeb) {
        await ensureDir();
        await fs.writeFile(filePath, JSON.stringify(rules, null, 2), 'utf-8');
      }
    } catch {}

    return NextResponse.json({ success: true, category, rules });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-rules GET Error]:', error);
    return NextResponse.json({ error: '매칭 규칙 조회 실패' }, { status: 500 });
  }
}

/**
 * [POST] 명세표 매칭 규칙 및 칼럼 키워드 설정 저장 (카테고리별 분리 저장)
 */
export async function POST(req: Request) {
  try {
    await authorizeAnyMenuPaths(WRITE_PATHS, { requireEditor: true });
    await ensureDir();

    const body = await req.json();
    const category = String(body.category || 'SIGN').trim().toUpperCase() || 'SIGN';

    const defaults = getDefaultRulesForCategory(category);
    const rules: ProductionStatementRules = migrateLegacyZebCertKeywords(
      {
        columnHeaders: {
          ...defaults.columnHeaders,
          ...(body.columnHeaders || {}),
        },
        certTypeKeywords:
          body.certTypeKeywords !== undefined
            ? body.certTypeKeywords
            : defaults.certTypeKeywords,
        plateItemKeywords:
          body.plateItemKeywords !== undefined
            ? body.plateItemKeywords
            : defaults.plateItemKeywords,
      },
      category
    );

    const filePath = getRulesFilePath(category);
    await fs.writeFile(filePath, JSON.stringify(rules, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      category,
      message: `[${category}] 명세표 매칭 규칙 및 키워드가 성공적으로 저장되었습니다.`,
      rules,
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[statement-rules POST Error]:', error);
    return NextResponse.json(
      { error: error.message || '매칭 규칙 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
