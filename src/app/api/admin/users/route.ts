import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { generateTempPassword } from '@/utils/tempPassword';
import { resolveCompanyEmail, COMPANY_EMAIL_SUFFIX } from '@/utils/companyEmail';
import {
  DEFAULT_USER_DUTY_OPTIONS,
  DEFAULT_USER_GRADE_OPTIONS,
  compareUsersByDutyGrade,
  normalizeUserJobOptions,
  resolveUserDutyOptions,
  resolveUserGradeOptions,
  type UserJobOption,
} from '@/lib/user-job-options';

const USER_UPDATE_WHITELIST = [
  'name',
  'name_en',
  'employee_no',
  'unit_id',
  'duty',
  'duty_en',
  'grade',
  'grade_en',
  'roles',
  'status',
] as const;

function pickUserUpdate(raw: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of USER_UPDATE_WHITELIST) {
    if (key in raw) data[key] = raw[key];
  }
  return data;
}

function parseRoles(roles: unknown): string[] {
  if (Array.isArray(roles)) return roles.map(String);
  if (typeof roles === 'string') {
    try {
      const parsed = JSON.parse(roles);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* plain string */
    }
    return [roles];
  }
  return [];
}

function isLv1Roles(roles: unknown) {
  return parseRoles(roles).some((r) => /LV_?1/i.test(String(r)));
}

function normalizeRolesInput(raw: unknown): string[] {
  const roleRaw = Array.isArray(raw)
    ? String(raw[0] || 'LV_3')
    : String(raw || 'LV_3');
  const role = ['LV_1', 'LV_2', 'LV_3'].includes(roleRaw) ? roleRaw : 'LV_3';
  return [role];
}

async function assertEmployeeNoAvailable(employeeNo: string, excludeUserId?: string) {
  const no = String(employeeNo || '').trim();
  if (!no) return;
  const clash = await prisma.user.findFirst({
    where: {
      employee_no: no,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true, name: true, email: true },
  });
  if (clash) {
    const err = new Error('EMPLOYEE_NO_DUP') as Error & { clashName?: string };
    err.clashName = clash.name || clash.email;
    throw err;
  }
}

async function readJobOptions(): Promise<{ duties: UserJobOption[]; grades: UserJobOption[] }> {
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

async function writeJobOptions(duties: UserJobOption[], grades: UserJobOption[]) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SystemConfig" (id, "user_duty_options", "user_grade_options", "updatedAt")
     VALUES ('global', $1::jsonb, $2::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "user_duty_options" = EXCLUDED."user_duty_options",
       "user_grade_options" = EXCLUDED."user_grade_options",
       "updatedAt" = NOW()`,
    JSON.stringify(duties),
    JSON.stringify(grades)
  );
}

// ==========================================
// [GET] 전체 사용자 목록 + 직책/직급 옵션
// ==========================================
export async function GET() {
  try {
    await authorizeAdminApi();

    // 이미 미사용인 조직에 남아 있는 unit_id 정리
    await prisma.user.updateMany({
      where: { unit: { is_active: false } },
      data: { unit_id: null },
    });

    const users = await prisma.user.findMany({
      include: {
        unit: {
          select: { id: true, unit_name: true, is_active: true },
        },
      },
    });

    const stats = { totalUsers: users.length };
    const jobOptions = await readJobOptions();

    users.sort((a, b) =>
      compareUsersByDutyGrade(a, b, jobOptions.duties, jobOptions.grades)
    );

    return NextResponse.json(
      { users, stats, duties: jobOptions.duties, grades: jobOptions.grades },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('사용자 로드 에러:', error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// [POST] 관리자 신규 인원 등록
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();

    const body = await req.json();
    const name = String(body.name ?? '').trim();
    const name_en = String(body.name_en ?? '').trim();
    const employee_no = String(body.employee_no ?? '').trim();
    const email = resolveCompanyEmail(body.email ?? body.emailLocal);
    const unit_id = body.unit_id ? String(body.unit_id) : null;
    const duty = String(body.duty ?? '').trim();
    const duty_en = String(body.duty_en ?? '').trim();
    const grade = String(body.grade ?? '').trim();
    const grade_en = String(body.grade_en ?? '').trim();

    const role = normalizeRolesInput(
      Array.isArray(body.roles) ? body.roles : body.role || body.roles
    )[0];

    const statusRaw = String(body.status ?? 'Active').trim();
    const status =
      statusRaw.toLowerCase() === 'suspended' ? 'Suspended' : 'Active';

    if (!name || !email) {
      return NextResponse.json(
        { message: `성명과 사내메일(${COMPANY_EMAIL_SUFFIX})은 필수입니다.` },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      return NextResponse.json({ message: '이미 등록된 이메일입니다.' }, { status: 409 });
    }

    try {
      await assertEmployeeNoAvailable(employee_no);
    } catch (e: any) {
      if (e?.message === 'EMPLOYEE_NO_DUP') {
        return NextResponse.json(
          { message: `이미 사용 중인 사번입니다.${e.clashName ? ` (${e.clashName})` : ''}` },
          { status: 409 }
        );
      }
      throw e;
    }

    if (unit_id) {
      const unit = await prisma.orgUnit.findFirst({
        where: { id: unit_id, is_deleted: false },
        select: { id: true },
      });
      if (!unit) {
        return NextResponse.json({ message: '선택한 조직을 찾을 수 없습니다.' }, { status: 400 });
      }
    }

    // 임시 비밀번호: 사번 우선, 없으면 랜덤 · 다음 로그인 강제 변경
    const tempPassword = employee_no || generateTempPassword(10);
    const hashed = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        name_en,
        employee_no,
        password: hashed,
        roles: [role],
        status,
        unit_id,
        duty,
        duty_en,
        grade,
        grade_en,
        must_reset_password: true,
      },
      include: {
        unit: { select: { id: true, unit_name: true, is_active: true } },
      },
    });

    return NextResponse.json({
      message: '신규 인원이 등록되었습니다.',
      user,
      tempPassword,
      kind: 'reset',
    });
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('신규 등록 에러:', error);
    return NextResponse.json({ message: '신규 등록에 실패했습니다.' }, { status: 500 });
  }
}

// [PATCH] 사용자 정보 수정 / 비밀번호 / 직책·직급 옵션
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();

    const body = await req.json();
    const { action } = body;

    // 직책·직급 옵션 저장 (/admin/users 전용)
    if (action === 'saveJobOptions') {
      const duties = normalizeUserJobOptions(body.duties);
      const grades = normalizeUserJobOptions(body.grades);
      if (duties.length === 0 && grades.length === 0) {
        return NextResponse.json({ message: '직책/직급 옵션이 비어 있습니다.' }, { status: 400 });
      }
      await writeJobOptions(
        duties.length > 0 ? duties : [...DEFAULT_USER_DUTY_OPTIONS],
        grades.length > 0 ? grades : [...DEFAULT_USER_GRADE_OPTIONS]
      );
      const saved = await readJobOptions();
      return NextResponse.json({ message: '직책·직급 옵션이 저장되었습니다.', ...saved });
    }

    // 시드 기본값으로 복구
    if (action === 'restoreJobOptions') {
      await writeJobOptions([...DEFAULT_USER_DUTY_OPTIONS], [...DEFAULT_USER_GRADE_OPTIONS]);
      const saved = await readJobOptions();
      return NextResponse.json({
        message: '시드 기본 직책·직급 옵션으로 복구했습니다.',
        ...saved,
      });
    }

    const { userId } = body;
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    // 🔐 비밀번호 초기화 = 임시 비밀번호를 사번으로 설정 + 다음 로그인 강제 변경
    if (action === 'resetPassword' || action === 'firstSetup') {
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) {
        return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
      }
      const employeeNo = String(existing.employee_no || '').trim();
      if (!employeeNo) {
        return NextResponse.json(
          { message: '사번이 없어 비밀번호를 초기화할 수 없습니다. 사번을 먼저 등록해 주세요.' },
          { status: 400 }
        );
      }
      const hashed = await bcrypt.hash(employeeNo, 10);
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashed,
          must_reset_password: true,
          password_reset_requested: false,
          password_reset_requested_at: null,
        },
      });
      return NextResponse.json({
        message: '비밀번호가 사번으로 초기화되었습니다. 다음 로그인 시 비밀번호 변경이 필요합니다.',
        tempPassword: employeeNo,
        email: existing.email,
        name: existing.name,
        employee_no: employeeNo,
        kind: 'reset',
      });
    }

    const updateData = pickUserUpdate(body);

    // roles: Json 배열로 저장 (문자열 이중 인코딩 금지)
    if (updateData.roles !== undefined) {
      updateData.roles = normalizeRolesInput(updateData.roles);
    }

    if (typeof updateData.employee_no === 'string') {
      updateData.employee_no = updateData.employee_no.trim();
      try {
        await assertEmployeeNoAvailable(String(updateData.employee_no), userId);
      } catch (e: any) {
        if (e?.message === 'EMPLOYEE_NO_DUP') {
          return NextResponse.json(
            { message: `이미 사용 중인 사번입니다.${e.clashName ? ` (${e.clashName})` : ''}` },
            { status: 409 }
          );
        }
        throw e;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '수정할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('수정 에러:', error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 사용자 완전 삭제 — LV_1 전용
export async function DELETE(req: Request) {
  try {
    const actor = await authorizeAdminApi();

    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    if (userId === actor.id) {
      return NextResponse.json({ message: '본인 계정은 삭제할 수 없습니다.' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true, name: true },
    });
    if (!target) {
      return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (isLv1Roles(target.roles)) {
      const all = await prisma.user.findMany({ select: { id: true, roles: true } });
      const lv1Count = all.filter((u) => isLv1Roles(u.roles)).length;
      if (lv1Count <= 1) {
        return NextResponse.json(
          { message: '마지막 LV_1(시스템 운영자) 계정은 삭제할 수 없습니다.' },
          { status: 400 }
        );
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error('삭제 에러:', error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
