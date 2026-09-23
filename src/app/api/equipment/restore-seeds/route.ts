import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeEquipmentApi, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  isSeedableEquipmentCategory,
  runSeedEquipmentPerformance,
  SEED_EQUIPMENT_BY_CATEGORY,
} from '@/lib/equipment-seed-performance';

export const dynamic = 'force-dynamic';

/**
 * POST { action: 'restore-seeds', categoryCode: 'safety' | 'performance' | 'airtightness' }
 * LV_1 전용 — 해당 범주 시드 중 없는 항목만 추가 (기존 자산번호는 덮어쓰지 않음)
 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeEquipmentApi();
    const body = await req.json().catch(() => ({}));

    if (body?.action !== 'restore-seeds') {
      return NextResponse.json({ error: '지원하지 않는 action 입니다.' }, { status: 400 });
    }

    if (auth.permission?.myRole !== 'LV_1') {
      return NextResponse.json(
        { error: '시드 장비 복구는 LV_1만 가능합니다.' },
        { status: 403 }
      );
    }

    const categoryCode = String(body?.categoryCode || '').trim();
    if (!categoryCode || !isSeedableEquipmentCategory(categoryCode)) {
      return NextResponse.json(
        {
          error:
            'categoryCode가 필요합니다. (safety | performance | airtightness)',
        },
        { status: 400 }
      );
    }

    const seedCount = SEED_EQUIPMENT_BY_CATEGORY[categoryCode].length;
    if (seedCount === 0) {
      return NextResponse.json({
        success: true,
        message: `「${categoryCode}」시드 데이터가 아직 없습니다. (준비 중)`,
        category: categoryCode,
        created: 0,
        updated: 0,
        skipped: 0,
        renamed: 0,
        seedCount: 0,
      });
    }

    const result = await runSeedEquipmentPerformance(prisma, 'fill', categoryCode);

    return NextResponse.json({
      success: true,
      message:
        result.created + result.updated === 0
          ? `복구할 시드 장비가 없습니다. (이미 모두 등록됨 · ${result.seedCount}건)`
          : `시드 장비 복구 완료 (신규 ${result.created}건${result.updated ? `, 범주 교정 ${result.updated}건` : ''})`,
      ...result,
    });
  } catch (e) {
    const authRes = authErrorToResponse(e);
    if (authRes) return authRes;
    console.error('[equipment/restore-seeds]', e);
    return NextResponse.json({ error: '시드 장비 복구 실패' }, { status: 500 });
  }
}
