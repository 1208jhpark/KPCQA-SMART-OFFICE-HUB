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
  findJobOptionRenames,
  matchJobOptionForStored,
  normalizeDutyCode,
  normalizeGradeCode,
  normalizeUserDutyOptions,
  normalizeUserGradeOptions,
  resolveUserDutyOptions,
  resolveUserGradeOptions,
  type UserJobOption,
} from '@/lib/user-job-options';

const USER_UPDATE_WHITELIST = [
  'name',
  'name_en',
  'employee_no',
  'extension',
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

/**
 * 이미 저장된 옵션 코드는 클라이언트가 바꿔 보내도 유지.
 * (한글 라벨이 같으면 이전 코드로 복구, 같은 코드면 표기만 정규화)
 */
function lockExistingJobOptionCodes(
  incoming: UserJobOption[],
  previous: UserJobOption[],
  normalizeCode: (c: unknown) => string
): UserJobOption[] {
  const prevByCode = new Map(
    previous
      .map((p) => {
        const code = normalizeCode(p.code);
        return code ? ([code, String(p.code || '').trim()] as const) : null;
      })
      .filter((x): x is readonly [string, string] => !!x)
  );
  const prevByLabel = new Map(
    previous
      .map((p) => {
        const label = String(p.label || '').trim();
        const code = normalizeCode(p.code);
        return label && code ? ([label, String(p.code || '').trim()] as const) : null;
      })
      .filter((x): x is readonly [string, string] => !!x)
  );

  return incoming.map((row) => {
    const label = String(row.label || '').trim();
    const codeKey = normalizeCode(row.code);
    if (codeKey && prevByCode.has(codeKey)) {
      return { ...row, code: prevByCode.get(codeKey)! };
    }
    const byLabel = label ? prevByLabel.get(label) : undefined;
    if (byLabel) {
      return { ...row, code: byLabel };
    }
    return row;
  });
}

/** 시드 코드가 빠졌으면 기본값으로 보강 (한글·영문은 요청값이 있으면 유지) */
function ensureSeedJobOptions(
  list: UserJobOption[],
  seeds: UserJobOption[],
  normalizeCode: (c: unknown) => string
): UserJobOption[] {
  const byCode = new Map(
    list
      .filter((o) => o.code)
      .map((o) => [normalizeCode(o.code), o] as const)
  );
  const merged: UserJobOption[] = [];
  for (const seed of seeds) {
    const code = normalizeCode(seed.code);
    const hit = byCode.get(code);
    if (hit) {
      merged.push({ ...hit, code: seed.code });
      byCode.delete(code);
    } else {
      merged.push({ ...seed });
    }
  }
  for (const o of list) {
    const code = normalizeCode(o.code);
    if (code && byCode.has(code)) {
      merged.push(o);
      byCode.delete(code);
    } else if (!code) {
      merged.push(o);
    }
  }
  return merged;
}

/**
 * 옵션 한글/영문 변경 → 기존 사용자 duty·grade 동기화
 * 1) 이전 옵션→새 옵션 rename (코드·영문 매칭)
 * 2) 이미 어긋난 사용자: 레거시 한글·영문·코드로 현재 옵션에 재매핑
 */
async function syncUsersToJobOptions(
  prev: { duties: UserJobOption[]; grades: UserJobOption[] },
  nextDuties: UserJobOption[],
  nextGrades: UserJobOption[]
): Promise<{ dutyUpdated: number; gradeUpdated: number }> {
  let dutyUpdated = 0;
  let gradeUpdated = 0;

  for (const r of findJobOptionRenames(prev.duties, nextDuties, 'duty')) {
    const res = await prisma.user.updateMany({
      where: { duty: r.fromLabel },
      data: { duty: r.toLabel, duty_en: r.toEn },
    });
    dutyUpdated += res.count;
  }
  for (const r of findJobOptionRenames(prev.grades, nextGrades, 'grade')) {
    const res = await prisma.user.updateMany({
      where: { grade: r.fromLabel },
      data: { grade: r.toLabel, grade_en: r.toEn },
    });
    gradeUpdated += res.count;
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { duty: { not: '' } },
        { grade: { not: '' } },
        { duty_en: { not: '' } },
        { grade_en: { not: '' } },
      ],
    },
    select: { id: true, duty: true, duty_en: true, grade: true, grade_en: true },
  });

  for (const u of users) {
    const data: { duty?: string; duty_en?: string; grade?: string; grade_en?: string } = {};
    const dutyOpt = matchJobOptionForStored(u.duty, u.duty_en, nextDuties, 'duty');
    if (dutyOpt && (u.duty !== dutyOpt.label || (u.duty_en || '') !== (dutyOpt.value || ''))) {
      data.duty = dutyOpt.label;
      data.duty_en = dutyOpt.value || '';
    }
    const gradeOpt = matchJobOptionForStored(u.grade, u.grade_en, nextGrades, 'grade');
    if (gradeOpt && (u.grade !== gradeOpt.label || (u.grade_en || '') !== (gradeOpt.value || ''))) {
      data.grade = gradeOpt.label;
      data.grade_en = gradeOpt.value || '';
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.user.update({ where: { id: u.id }, data });
    if (data.duty !== undefined) dutyUpdated += 1;
    if (data.grade !== undefined) gradeUpdated += 1;
  }

  return { dutyUpdated, gradeUpdated };
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

type CreateUserInput = {
  name: string;
  name_en?: string;
  employee_no?: string;
  extension?: string;
  email?: string | null;
  emailLocal?: string | null;
  unit_id?: string | null;
  unitName?: string | null;
  duty?: string;
  duty_en?: string;
  grade?: string;
  grade_en?: string;
  role?: string;
  roles?: unknown;
  status?: string;
};

async function createOneAdminUser(
  body: CreateUserInput,
  opts?: {
    unitsByName?: Map<string, string>;
    duties?: UserJobOption[];
    grades?: UserJobOption[];
  }
) {
  const name = String(body.name ?? '').trim();
  const name_en = String(body.name_en ?? '').trim();
  const employee_no = String(body.employee_no ?? '').trim();
  const extension = String(body.extension ?? '').trim();
  const email = resolveCompanyEmail(body.email ?? body.emailLocal);

  let unit_id = body.unit_id ? String(body.unit_id) : null;
  if (!unit_id && body.unitName) {
    const key = String(body.unitName).trim();
    unit_id = opts?.unitsByName?.get(key) || null;
    if (key && !unit_id) {
      return { ok: false as const, status: 400, message: `조직을 찾을 수 없습니다: ${key}` };
    }
  }

  let duty = String(body.duty ?? '').trim();
  let duty_en = String(body.duty_en ?? '').trim();
  let grade = String(body.grade ?? '').trim();
  let grade_en = String(body.grade_en ?? '').trim();

  if (duty && !duty_en && opts?.duties) {
    duty_en = opts.duties.find((d) => d.label === duty)?.value || '';
  }
  if (grade && !grade_en && opts?.grades) {
    grade_en = opts.grades.find((g) => g.label === grade)?.value || '';
  }

  const role = normalizeRolesInput(
    Array.isArray(body.roles) ? body.roles : body.role || body.roles
  )[0];

  const statusRaw = String(body.status ?? 'Active').trim();
  const status = statusRaw.toLowerCase() === 'suspended' ? 'Suspended' : 'Active';

  if (!name || !email) {
    return {
      ok: false as const,
      status: 400,
      message: `성명과 사내메일(${COMPANY_EMAIL_SUFFIX})은 필수입니다.`,
    };
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (existing) {
    return { ok: false as const, status: 409, message: '이미 등록된 이메일입니다.', email };
  }

  try {
    await assertEmployeeNoAvailable(employee_no);
  } catch (e: any) {
    if (e?.message === 'EMPLOYEE_NO_DUP') {
      return {
        ok: false as const,
        status: 409,
        message: `이미 사용 중인 사번입니다.${e.clashName ? ` (${e.clashName})` : ''}`,
        email,
      };
    }
    throw e;
  }

  if (unit_id) {
    const unit = await prisma.orgUnit.findFirst({
      where: { id: unit_id, is_deleted: false },
      select: { id: true },
    });
    if (!unit) {
      return { ok: false as const, status: 400, message: '선택한 조직을 찾을 수 없습니다.', email };
    }
  }

  const tempPassword = employee_no || generateTempPassword(10);
  const hashed = await bcrypt.hash(tempPassword, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        name_en,
        employee_no,
        extension,
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

    return {
      ok: true as const,
      user,
      tempPassword,
      email,
    };
  } catch (e: any) {
    // 동시 등록·레이스 시 unique 제약
    if (e?.code === 'P2002') {
      const targets = Array.isArray(e?.meta?.target) ? e.meta.target.map(String) : [];
      if (targets.some((t: string) => t.toLowerCase().includes('email'))) {
        return { ok: false as const, status: 409, message: '이미 등록된 이메일입니다.', email };
      }
      if (targets.some((t: string) => t.toLowerCase().includes('employee'))) {
        return { ok: false as const, status: 409, message: '이미 사용 중인 사번입니다.', email };
      }
      return { ok: false as const, status: 409, message: '이미 등록된 이메일입니다.', email };
    }
    throw e;
  }
}

// [POST] 관리자 신규 인원 등록 / 엑셀 일괄 등록
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();

    const body = await req.json();

    if (body?.action === 'bulkCreate') {
      const rows = Array.isArray(body.users) ? body.users : [];
      if (rows.length === 0) {
        return NextResponse.json({ message: '등록할 행이 없습니다.' }, { status: 400 });
      }
      if (rows.length > 200) {
        return NextResponse.json({ message: '한 번에 200명까지 등록할 수 있습니다.' }, { status: 400 });
      }

      const [units, jobOptions] = await Promise.all([
        prisma.orgUnit.findMany({
          where: { is_deleted: false, is_active: true },
          select: { id: true, unit_name: true },
        }),
        readJobOptions(),
      ]);
      const unitsByName = new Map(
        units
          .map((u) => [String(u.unit_name || '').trim(), u.id] as const)
          .filter(([name]) => !!name)
      );

      const created: Array<{ email: string; name: string; tempPassword: string }> = [];
      const failed: Array<{ row: number; email?: string; message: string }> = [];
      const skippedDuplicate: Array<{ row: number; email: string; reason: string }> = [];
      const seenEmails = new Set<string>();

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i] || {};
        const emailKey = resolveCompanyEmail(row.email ?? row.emailLocal)?.toLowerCase() || '';
        if (emailKey && seenEmails.has(emailKey)) {
          skippedDuplicate.push({
            row: i + 1,
            email: emailKey,
            reason: '엑셀 내 중복 이메일',
          });
          failed.push({
            row: i + 1,
            email: emailKey,
            message: '엑셀 내 중복 이메일이라 건너뛰었습니다.',
          });
          continue;
        }

        const result = await createOneAdminUser(row, {
          unitsByName,
          duties: jobOptions.duties,
          grades: jobOptions.grades,
        });
        if (!result.ok) {
          if (result.status === 409 && result.message.includes('이메일')) {
            skippedDuplicate.push({
              row: i + 1,
              email: result.email || emailKey,
              reason: '이미 등록된 이메일',
            });
          }
          failed.push({
            row: i + 1,
            email: result.email,
            message: result.message,
          });
          continue;
        }
        if (result.email) seenEmails.add(String(result.email).toLowerCase());
        else if (emailKey) seenEmails.add(emailKey);
        created.push({
          email: result.email || result.user.email,
          name: result.user.name,
          tempPassword: result.tempPassword,
        });
      }

      return NextResponse.json({
        message: `일괄 등록 완료 (성공 ${created.length} · 실패 ${failed.length} · 이메일중복제외 ${skippedDuplicate.length})`,
        created,
        failed,
        skippedDuplicate,
      });
    }

    const result = await createOneAdminUser(body);
    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: result.status });
    }

    return NextResponse.json({
      message: '신규 인원이 등록되었습니다.',
      user: result.user,
      tempPassword: result.tempPassword,
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
      const prev = await readJobOptions();
      const duties = lockExistingJobOptionCodes(
        normalizeUserDutyOptions(body.duties),
        prev.duties,
        normalizeDutyCode
      );
      const grades = lockExistingJobOptionCodes(
        normalizeUserGradeOptions(body.grades),
        prev.grades,
        normalizeGradeCode
      );
      if (duties.length === 0 && grades.length === 0) {
        return NextResponse.json({ message: '직책/직급 옵션이 비어 있습니다.' }, { status: 400 });
      }
      const nextDuties = ensureSeedJobOptions(
        duties.length > 0 ? duties : [...DEFAULT_USER_DUTY_OPTIONS],
        DEFAULT_USER_DUTY_OPTIONS,
        normalizeDutyCode
      );
      const nextGrades = ensureSeedJobOptions(
        grades.length > 0 ? grades : [...DEFAULT_USER_GRADE_OPTIONS],
        DEFAULT_USER_GRADE_OPTIONS,
        normalizeGradeCode
      );
      const synced = await syncUsersToJobOptions(prev, nextDuties, nextGrades);
      await writeJobOptions(nextDuties, nextGrades);
      const saved = await readJobOptions();
      const syncNote =
        synced.dutyUpdated + synced.gradeUpdated > 0
          ? ` (사용자 직책 ${synced.dutyUpdated}명·직급 ${synced.gradeUpdated}명 동기화)`
          : '';
      return NextResponse.json({
        message: `직책·직급 옵션이 저장되었습니다.${syncNote}`,
        ...saved,
        synced,
      });
    }

    // 시드 기본값으로 복구
    if (action === 'restoreJobOptions') {
      const prev = await readJobOptions();
      const nextDuties = [...DEFAULT_USER_DUTY_OPTIONS];
      const nextGrades = [...DEFAULT_USER_GRADE_OPTIONS];
      const synced = await syncUsersToJobOptions(prev, nextDuties, nextGrades);
      await writeJobOptions(nextDuties, nextGrades);
      const saved = await readJobOptions();
      const syncNote =
        synced.dutyUpdated + synced.gradeUpdated > 0
          ? ` (사용자 직책 ${synced.dutyUpdated}명·직급 ${synced.gradeUpdated}명 동기화)`
          : '';
      return NextResponse.json({
        message: `시드 기본 직책·직급 옵션으로 복구했습니다.${syncNote}`,
        ...saved,
        synced,
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

    if (typeof updateData.extension === 'string') {
      updateData.extension = updateData.extension.trim();
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
