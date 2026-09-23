import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingClientsCreate,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { SEED_MARKETING_CLIENTS } from '@/lib/marketing-client-seed';
import { runSeedMarketingClients } from '@/lib/marketing-client-seed-run';

export const dynamic = 'force-dynamic';

/**
 * POST { action: 'restore-seeds' }
 * LV_1만 — 시드에 없는 고객사명만 추가 (이미 있는 명칭은 유지)
 * ※ 영구삭제(지급이력 0건)된 시드 복구용
 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeMarketingClientsCreate();
    if (auth.permission.myRole !== 'LV_1') {
      return NextResponse.json(
        { error: '시드 고객사 복구는 최고 관리자(LV_1)만 가능합니다.' },
        { status: 403 }
      );
    }
    const body = await req.json().catch(() => ({}));

    if (body?.action !== 'restore-seeds') {
      return NextResponse.json({ error: '지원하지 않는 action 입니다.' }, { status: 400 });
    }

    const seedCount = SEED_MARKETING_CLIENTS.length;
    if (seedCount === 0) {
      return NextResponse.json({
        success: true,
        message: '고객사 시드 데이터가 없습니다.',
        created: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
        seedCount: 0,
      });
    }

    const result = await runSeedMarketingClients(prisma, 'fill');

    return NextResponse.json({
      success: true,
      message:
        result.created === 0
          ? `복구할 시드 고객사가 없습니다. (이미 모두 등록됨 · ${result.seedCount}건)`
          : `시드 고객사 복구 완료 (신규 ${result.created}건)`,
      ...result,
    });
  } catch (e) {
    const authRes = authErrorToResponse(e);
    if (authRes) return authRes;
    console.error('[marketing/clients/restore-seeds]', e);
    return NextResponse.json({ error: '시드 고객사 복구 실패' }, { status: 500 });
  }
}
