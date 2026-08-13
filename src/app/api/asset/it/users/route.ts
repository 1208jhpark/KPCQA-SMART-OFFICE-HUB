import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/it/master/dashboard';

/**
 * [GET] IT 마스터 대시보드용 사용자 명단
 * - /api/admin/users(LV_1 전용) 대체
 * - admin/users와 동일하게 unit 소속·성명 기준으로 부서별 사용자 선택에 사용
 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const users = await prisma.user.findMany({
      where: { status: 'Active' },
      select: {
        id: true,
        name: true,
        email: true,
        unit_id: true,
        status: true,
        unit: {
          select: { id: true, unit_name: true, is_active: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(
      {
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          unit_id: u.unit_id,
          status: u.status,
          unit: u.unit
            ? { id: u.unit.id, unit_name: u.unit.unit_name, is_active: u.unit.is_active }
            : null,
          dept: u.unit?.unit_name || '',
        })),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/users GET]', error);
    return NextResponse.json({ error: '사용자 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
