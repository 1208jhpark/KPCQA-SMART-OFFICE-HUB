import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { getKSTDateString } from '@/utils/dateUtils';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/it/dept';
const PASSWORD_MASK = '****';

type ScopeUnit = { id: string; unit_name: string };

function resolveScopeUnits(
  myUnit: { id: string; unit_name: string },
  allUnits: Array<{ id: string; unit_name: string; parent_id: string | null }>,
  scopeRaw: string
): ScopeUnit[] {
  const scope = String(scopeRaw || 'NONE').toUpperCase();
  const scopeUnits: ScopeUnit[] = [];
  const seen = new Set<string>();
  const push = (u: { id: string; unit_name: string } | null | undefined) => {
    if (!u?.id || !u.unit_name || seen.has(u.id)) return;
    seen.add(u.id);
    scopeUnits.push({ id: u.id, unit_name: u.unit_name });
  };

  if (scope === 'NONE') return [];
  push({ id: myUnit.id, unit_name: myUnit.unit_name });
  if (scope === 'OWN') return scopeUnits;

  if (scope === 'DEPT') {
    allUnits.filter((u) => u.parent_id === myUnit.id).forEach((c) => push(c));
  } else if (scope === 'TOTAL') {
    const walk = (parentId: string) => {
      allUnits
        .filter((u) => u.parent_id === parentId)
        .forEach((c) => {
          push(c);
          walk(c.id);
        });
    };
    walk(myUnit.id);
  }
  return scopeUnits;
}

function serializeRow(row: any, revealPassword: boolean) {
  return {
    id: row.id,
    unit_id: row.unit_id,
    dept: row.dept,
    person_name: row.person_name,
    registered_date: row.registered_date,
    program_type: row.program_type || '',
    program_used: !!row.program_used,
    program_id: row.program_id || '',
    program_password: revealPassword
      ? row.program_password || ''
      : row.program_password
        ? PASSWORD_MASK
        : '',
    password_revealed: revealPassword,
    ip_address: row.ip_address || '',
    mac_address: row.mac_address || '',
    note1: row.note1 || '',
    note2: row.note2 || '',
    note3: row.note3 || '',
    created_by_name: row.created_by_name || '',
    created_by_email: row.created_by_email || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadAuthContext() {
  const auth = await authorizeApi(MENU_PATH);
  const myUnit = auth.user.unit;
  if (!myUnit?.id || !myUnit.unit_name) {
    throw new Error('NO_UNIT');
  }
  const allUnits = (auth.unitsList || []).map((u: any) => ({
    id: String(u.id),
    unit_name: String(u.unit_name || ''),
    parent_id: u.parent_id ? String(u.parent_id) : null,
  }));
  const viewScope = String(auth.permission?.viewScope || 'NONE').toUpperCase();
  const editScope = String(auth.permission?.editScope || 'NONE').toUpperCase();

  // 메뉴 Access 통과 시 최소 본인 소속은 항상 조회 가능 (viewScope NONE이어도)
  let accessibleUnits = resolveScopeUnits(
    { id: myUnit.id, unit_name: myUnit.unit_name },
    allUnits,
    viewScope === 'NONE' ? 'OWN' : viewScope
  );
  if (accessibleUnits.length === 0) {
    accessibleUnits = [{ id: myUnit.id, unit_name: myUnit.unit_name }];
  }

  const editableUnits =
    editScope === 'NONE' || !auth.permission?.isEditor
      ? []
      : resolveScopeUnits(
          { id: myUnit.id, unit_name: myUnit.unit_name },
          allUnits,
          editScope
        );
  const isEditor = !!auth.permission?.isEditor && editableUnits.length > 0;
  return {
    auth,
    myUnit: { id: myUnit.id, unit_name: myUnit.unit_name },
    accessibleUnits,
    editableUnits,
    isEditor,
    viewScope,
    editScope,
  };
}

/** [GET] 부서 인력별 프로그램 사용 목록 (Access 전원 · 비밀번호는 Edit+수정 시에만 평문) */
export async function GET(req: Request) {
  try {
    const ctx = await loadAuthContext();
    const { searchParams } = new URL(req.url);
    const singleId = String(searchParams.get('id') || '').trim();

    // Edit 전용: 수정 모달에서 비밀번호 평문 조회
    if (singleId) {
      if (!ctx.isEditor) {
        return NextResponse.json(
          { error: '비밀번호 조회는 Edit 권한이 필요합니다.' },
          { status: 403 }
        );
      }
      const row = await prisma.iTDeptProgramAccount.findUnique({ where: { id: singleId } });
      if (!row) {
        return NextResponse.json({ error: '대상을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (!ctx.editableUnits.some((u) => u.id === row.unit_id)) {
        return NextResponse.json(
          { error: '해당 조직 행을 조회할 권한이 없습니다.' },
          { status: 403 }
        );
      }
      return NextResponse.json({ row: serializeRow(row, true) });
    }

    const unitIds = ctx.accessibleUnits.map((u) => u.id);
    const rows = await prisma.iTDeptProgramAccount.findMany({
      where: { unit_id: { in: unitIds } },
      orderBy: [{ registered_date: 'desc' }, { createdAt: 'desc' }],
    });

    // reveal=1: Edit만 · 편집 가능 조직 행의 비밀번호 평문 (엑셀 등)
    const wantReveal =
      String(searchParams.get('reveal') || '').trim() === '1' ||
      String(searchParams.get('reveal') || '').toLowerCase() === 'true';
    if (wantReveal && !ctx.isEditor) {
      return NextResponse.json(
        { error: '비밀번호 평문 조회는 Edit 권한이 필요합니다.' },
        { status: 403 }
      );
    }
    const editableIdSet = new Set(ctx.editableUnits.map((u) => u.id));

    return NextResponse.json({
      rows: rows.map((r) =>
        serializeRow(r, wantReveal && ctx.isEditor && editableIdSet.has(r.unit_id))
      ),
      isEditor: ctx.isEditor,
      myUnitId: ctx.myUnit.id,
      myDeptName: ctx.myUnit.unit_name,
      accessibleUnitIds: unitIds,
      editableUnitIds: ctx.editableUnits.map((u) => u.id),
      viewScope: ctx.viewScope,
      editScope: ctx.editScope,
    });
  } catch (error: any) {
    if (error?.message === 'NO_UNIT') {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept/program-accounts GET]', error);
    return NextResponse.json({ error: '목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** [POST] 신규 등록 — Edit 필요 */
export async function POST(req: Request) {
  try {
    const ctx = await loadAuthContext();
    if (!ctx.isEditor || ctx.editableUnits.length === 0) {
      return NextResponse.json({ error: '등록 권한이 없습니다. (Edit 필요)' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const unitId = String(body.unit_id || ctx.myUnit.id).trim();
    const target = ctx.editableUnits.find((u) => u.id === unitId);
    if (!target) {
      return NextResponse.json({ error: '해당 조직에 등록할 권한이 없습니다.' }, { status: 403 });
    }

    const personName = String(body.person_name || '').trim();
    if (!personName) {
      return NextResponse.json({ error: '이름은 필수입니다.' }, { status: 400 });
    }

    const created = await prisma.iTDeptProgramAccount.create({
      data: {
        unit_id: target.id,
        dept: target.unit_name,
        person_name: personName,
        registered_date:
          String(body.registered_date || '').trim() || getKSTDateString(),
        program_type: String(body.program_type || '').trim() || null,
        program_used: !!body.program_used,
        program_id: String(body.program_id || '').trim() || null,
        program_password: String(body.program_password || '').trim() || null,
        ip_address: String(body.ip_address || '').trim() || null,
        mac_address: String(body.mac_address || '').trim() || null,
        note1: String(body.note1 || '').trim() || null,
        note2: String(body.note2 || '').trim() || null,
        note3: String(body.note3 || '').trim() || null,
        created_by_name: ctx.auth.user.name || null,
        created_by_email: ctx.auth.user.email || null,
      },
    });

    return NextResponse.json(serializeRow(created, true), { status: 201 });
  } catch (error: any) {
    if (error?.message === 'NO_UNIT') {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept/program-accounts POST]', error);
    return NextResponse.json({ error: '등록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** [PATCH] 수정 — Edit 필요 */
export async function PATCH(req: Request) {
  try {
    const ctx = await loadAuthContext();
    if (!ctx.isEditor || ctx.editableUnits.length === 0) {
      return NextResponse.json({ error: '수정 권한이 없습니다. (Edit 필요)' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    }

    const existing = await prisma.iTDeptProgramAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '대상을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!ctx.editableUnits.some((u) => u.id === existing.unit_id)) {
      return NextResponse.json({ error: '해당 조직 행을 수정할 권한이 없습니다.' }, { status: 403 });
    }

    const personName =
      body.person_name !== undefined
        ? String(body.person_name || '').trim()
        : existing.person_name;
    if (!personName) {
      return NextResponse.json({ error: '이름은 필수입니다.' }, { status: 400 });
    }

    const nextPassword =
      body.program_password === undefined
        ? existing.program_password
        : String(body.program_password) === PASSWORD_MASK
          ? existing.program_password
          : String(body.program_password || '').trim() || null;

    const updated = await prisma.iTDeptProgramAccount.update({
      where: { id },
      data: {
        person_name: personName,
        registered_date:
          body.registered_date !== undefined
            ? String(body.registered_date || '').trim() || null
            : existing.registered_date,
        program_type:
          body.program_type !== undefined
            ? String(body.program_type || '').trim() || null
            : existing.program_type,
        program_used:
          body.program_used !== undefined ? !!body.program_used : existing.program_used,
        program_id:
          body.program_id !== undefined
            ? String(body.program_id || '').trim() || null
            : existing.program_id,
        program_password: nextPassword,
        ip_address:
          body.ip_address !== undefined
            ? String(body.ip_address || '').trim() || null
            : existing.ip_address,
        mac_address:
          body.mac_address !== undefined
            ? String(body.mac_address || '').trim() || null
            : existing.mac_address,
        note1:
          body.note1 !== undefined
            ? String(body.note1 || '').trim() || null
            : existing.note1,
        note2:
          body.note2 !== undefined
            ? String(body.note2 || '').trim() || null
            : existing.note2,
        note3:
          body.note3 !== undefined
            ? String(body.note3 || '').trim() || null
            : existing.note3,
      },
    });

    return NextResponse.json(serializeRow(updated, true));
  } catch (error: any) {
    if (error?.message === 'NO_UNIT') {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept/program-accounts PATCH]', error);
    return NextResponse.json({ error: '수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** [DELETE] 삭제 — Edit 필요 */
export async function DELETE(req: Request) {
  try {
    const ctx = await loadAuthContext();
    if (!ctx.isEditor || ctx.editableUnits.length === 0) {
      return NextResponse.json({ error: '삭제 권한이 없습니다. (Edit 필요)' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    }

    const existing = await prisma.iTDeptProgramAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '대상을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!ctx.editableUnits.some((u) => u.id === existing.unit_id)) {
      return NextResponse.json({ error: '해당 조직 행을 삭제할 권한이 없습니다.' }, { status: 403 });
    }

    await prisma.iTDeptProgramAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'NO_UNIT') {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept/program-accounts DELETE]', error);
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
