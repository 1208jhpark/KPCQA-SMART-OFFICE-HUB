import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/requests';

/** 명함 관리자 대행 신청용 Hub 사용자 명단 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const users = await prisma.user.findMany({
      where: { status: 'Active' },
      select: {
        id: true,
        name: true,
        name_en: true,
        email: true,
        duty: true,
        duty_en: true,
        grade: true,
        grade_en: true,
        unit_id: true,
        unit: {
          select: {
            id: true,
            unit_name: true,
            unit_name_en: true,
            unit_type: true,
            parent_id: true,
            parent: {
              select: {
                id: true,
                unit_name: true,
                unit_name_en: true,
                unit_type: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(
      {
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          name_en: u.name_en || '',
          email: u.email,
          duty: u.duty || '',
          duty_en: u.duty_en || '',
          grade: u.grade || '',
          grade_en: u.grade_en || '',
          unit_id: u.unit_id,
          unit: u.unit
            ? {
                id: u.unit.id,
                unit_name: u.unit.unit_name,
                unit_name_en: u.unit.unit_name_en || '',
                unit_type: u.unit.unit_type,
                parent_id: u.unit.parent_id,
                parent: u.unit.parent
                  ? {
                      id: u.unit.parent.id,
                      unit_name: u.unit.parent.unit_name,
                      unit_name_en: u.unit.parent.unit_name_en || '',
                      unit_type: u.unit.parent.unit_type,
                    }
                  : null,
              }
            : null,
        })),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/master/users GET]', error);
    return NextResponse.json({ message: '사용자 목록 조회 실패' }, { status: 500 });
  }
}
