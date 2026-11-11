import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  DEFAULT_CORP_CARD_GROUPWARE_URL,
  resolveCorpCardGroupwareUrl,
} from '@/lib/corp-card-groupware';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/corp-card/dept/board';

let columnReady: Promise<void> | null = null;

async function ensureColumn() {
  if (!columnReady) {
    columnReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "corp_card_groupware_url" TEXT NOT NULL DEFAULT ''`
        );
      } catch (error) {
        columnReady = null;
        console.warn('[corp-card groupware] column ensure skipped', error);
      }
    })();
  }
  await columnReady;
}

async function readUserUrl(userId: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ corp_card_groupware_url: string | null }>>`
      SELECT "corp_card_groupware_url" FROM "User" WHERE id = ${userId} LIMIT 1
    `;
    return String(rows[0]?.corp_card_groupware_url || '').trim();
  } catch {
    return '';
  }
}

export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    await ensureColumn();
    const personal = await readUserUrl(String(auth.user?.id || ''));
    return NextResponse.json(
      {
        groupwareShortcutUrl: resolveCorpCardGroupwareUrl(personal),
        isPersonal: !!personal,
        userEmail: String(auth.user?.email || ''),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[corp-card board settings GET]', error);
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    await ensureColumn();
    const body = await req.json().catch(() => ({}));
    const next = resolveCorpCardGroupwareUrl(body.groupwareShortcutUrl);
    const userId = String(auth.user?.id || '');
    if (!userId) {
      return NextResponse.json({ message: '사용자 정보가 없습니다.' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "corp_card_groupware_url" = $1, "updatedAt" = NOW() WHERE id = $2`,
      next,
      userId
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
