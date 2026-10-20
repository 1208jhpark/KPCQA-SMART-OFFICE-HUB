import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
  compareUsersByDutyGrade,
  resolveUserDutyOptions,
  resolveUserGradeOptions,
} from '@/lib/user-job-options';

export const dynamic = 'force-dynamic';

const SCHEDULE_MENU_PATHS = ['/schedule', '/schedule/dashboard'] as const;

async function readJobOptions() {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ user_duty_options: unknown; user_grade_options: unknown }>
    >`
      SELECT "user_duty_options", "user_grade_options"
      FROM "SystemConfig" WHERE id = 'global'
    `;
    return {
      duties: resolveUserDutyOptions(rows[0]?.user_duty_options),
      grades: resolveUserGradeOptions(rows[0]?.user_grade_options),
    };
  } catch {
    return {
      duties: [...DEFAULT_USER_DUTY_OPTIONS],
      grades: [...DEFAULT_USER_GRADE_OPTIONS],
    };
  }
}

/** GET — 이 보드(동일 소속 unit)를 공유하는 사용자 목록 (/admin/users 와 동일 정렬) */
export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths([...SCHEDULE_MENU_PATHS]);
    const unitId = String(auth.user.unit_id || auth.user.unit?.id || '').trim();
    const unitName = String(auth.user.unit?.unit_name || '').trim();

    if (!unitId) {
      return NextResponse.json({ error: '소속 정보가 없습니다.' }, { status: 400 });
    }

    const [members, jobOptions] = await Promise.all([
      prisma.user.findMany({
        where: {
          unit_id: unitId,
          NOT: { status: { equals: 'Suspended', mode: 'insensitive' } },
        },
        select: {
          id: true,
          name: true,
          email: true,
          duty: true,
          grade: true,
        },
      }),
      readJobOptions(),
    ]);

    members.sort((a, b) =>
      compareUsersByDutyGrade(a, b, jobOptions.duties, jobOptions.grades)
    );

    return NextResponse.json({
      unitId,
      unitName,
      members: members.map((m) => ({
        id: m.id,
        name: String(m.name || '').trim() || m.email,
        email: m.email,
        duty: String(m.duty || '').trim(),
      })),
    });
  } catch (error: unknown) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[schedule/board-members GET]', msg);
    return NextResponse.json({ error: '공유 멤버 조회 실패', details: msg }, { status: 500 });
  }
}
