import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAdminApi,
  authErrorToResponse,
  requireSessionUser,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

/**
 * GET — 설정 조회
 * - 로그인 필수 (공개 차단)
 * - 레거시 경로: 신규 화면은 /api/admin/config 사용
 */
export async function GET() {
  try {
    await requireSessionUser();
    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    return NextResponse.json(config || {}, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

/**
 * POST — 단위 그룹만 저장 (레거시). LV_1만.
 * 신규 저장은 /api/admin/config PATCH 사용.
 */
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json().catch(() => ({}));
    const unitCategoryGroup =
      body.unit_category_group !== undefined
        ? String(body.unit_category_group ?? '')
        : undefined;

    if (unitCategoryGroup === undefined) {
      return NextResponse.json(
        { message: 'unit_category_group 값이 필요합니다.' },
        { status: 400 }
      );
    }

    const config = await prisma.systemConfig.upsert({
      where: { id: 'global' },
      update: { unit_category_group: unitCategoryGroup },
      create: { id: 'global', unit_category_group: unitCategoryGroup },
    });

    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    return NextResponse.json({ message: '설정 저장 실패' }, { status: 500 });
  }
}
