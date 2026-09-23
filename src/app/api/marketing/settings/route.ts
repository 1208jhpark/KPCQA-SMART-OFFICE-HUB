import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingDistributionsApply,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const DEFAULT_GROUPWARE_SHORTCUT_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';

/** SystemConfig 전사 기본값 (개인 미설정 시 fallback) */
async function readSystemDefaultUrl() {
  try {
    const rows = await prisma.$queryRaw<Array<{ mkt_groupware_shortcut_url: string | null }>>`
      SELECT "mkt_groupware_shortcut_url" FROM "SystemConfig" WHERE id = 'global'
    `;
    const url = String(rows[0]?.mkt_groupware_shortcut_url || '').trim();
    return url || DEFAULT_GROUPWARE_SHORTCUT_URL;
  } catch {
    return DEFAULT_GROUPWARE_SHORTCUT_URL;
  }
}

async function readUserUrl(userId: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ mkt_groupware_shortcut_url: string | null }>>`
      SELECT "mkt_groupware_shortcut_url" FROM "User" WHERE id = ${userId} LIMIT 1
    `;
    return String(rows[0]?.mkt_groupware_shortcut_url || '').trim();
  } catch {
    return '';
  }
}

/** GET: 로그인 사용자 개인 URL (없으면 전사 기본값) — Edit 불필요 */
export async function GET() {
  try {
    const auth = await authorizeMarketingDistributionsApply();
    const personal = await readUserUrl(auth.user.id);
    const fallback = await readSystemDefaultUrl();
    return NextResponse.json(
      {
        groupwareShortcutUrl: personal || fallback,
        isPersonal: !!personal,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json(
      { groupwareShortcutUrl: DEFAULT_GROUPWARE_SHORTCUT_URL, isPersonal: false },
      { status: 200 }
    );
  }
}

/** PUT: 본인 User 행에만 저장 — Edit 불필요 (개인 페이지 설정) */
export async function PUT(req: Request) {
  try {
    const auth = await authorizeMarketingDistributionsApply();
    const body = await req.json().catch(() => ({}));
    const next = String(body.groupwareShortcutUrl ?? '').trim() || DEFAULT_GROUPWARE_SHORTCUT_URL;

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "mkt_groupware_shortcut_url" = $1, "updatedAt" = NOW() WHERE id = $2`,
      next,
      auth.user.id
    );

    return NextResponse.json({
      groupwareShortcutUrl: next,
      isPersonal: true,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) {
      const body = await authRes.json().catch(() => ({} as { error?: string; message?: string }));
      return NextResponse.json(
        { message: body.error || body.message || '저장 권한이 없습니다.' },
        { status: authRes.status }
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ message: '설정 저장 실패', detail }, { status: 500 });
  }
}
