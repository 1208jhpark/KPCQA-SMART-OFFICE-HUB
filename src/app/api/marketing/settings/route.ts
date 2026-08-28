import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingDistributionsApply,
  authorizeMarketingDistributionsManage,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

export const DEFAULT_GROUPWARE_SHORTCUT_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';

async function readGroupwareShortcutUrl() {
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

async function writeGroupwareShortcutUrl(url: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "mkt_groupware_shortcut_url", "updatedAt")
     VALUES ('global', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "mkt_groupware_shortcut_url" = EXCLUDED."mkt_groupware_shortcut_url",
       "updatedAt" = NOW()`,
    url
  );
}

export async function GET() {
  try {
    await authorizeMarketingDistributionsApply();
    return NextResponse.json(
      { groupwareShortcutUrl: await readGroupwareShortcutUrl() },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json(
      { groupwareShortcutUrl: DEFAULT_GROUPWARE_SHORTCUT_URL },
      { status: 200 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    await authorizeMarketingDistributionsManage({ requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const next = String(body.groupwareShortcutUrl ?? '').trim() || DEFAULT_GROUPWARE_SHORTCUT_URL;
    await writeGroupwareShortcutUrl(next);
    return NextResponse.json({ groupwareShortcutUrl: await readGroupwareShortcutUrl() });
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
