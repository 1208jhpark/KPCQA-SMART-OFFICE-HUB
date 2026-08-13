import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/it/dept';

type ScopeUnit = { id: string; unit_name: string };

/** Edit scope 기준 메모 수정 가능 조직 (본인 + DEPT 직속하위 / TOTAL 전체하위) */
function resolveEditableUnits(
  myUnit: { id: string; unit_name: string },
  allUnits: Array<{ id: string; unit_name: string; parent_id: string | null }>,
  editScopeRaw: string
): ScopeUnit[] {
  const editScope = String(editScopeRaw || 'NONE').toUpperCase();
  const scopeUnits: ScopeUnit[] = [];
  const seen = new Set<string>();
  const push = (u: { id: string; unit_name: string } | null | undefined) => {
    if (!u?.id || !u.unit_name || seen.has(u.id)) return;
    seen.add(u.id);
    scopeUnits.push({ id: u.id, unit_name: u.unit_name });
  };

  push({ id: myUnit.id, unit_name: myUnit.unit_name });
  if (editScope === 'NONE') return [];
  if (editScope === 'OWN') return scopeUnits;

  if (editScope === 'DEPT') {
    allUnits
      .filter((u) => u.parent_id === myUnit.id)
      .forEach((c) => push(c));
  } else if (editScope === 'TOTAL') {
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

/**
 * [GET] 부서 공유 메모판 (OrgUnit.supply_storage_note — 소모품 부서와 동일 필드)
 */
export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const myUnit = auth.user.unit;
    if (!myUnit?.id || !myUnit.unit_name) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const allUnits = (auth.unitsList || []).map((u: any) => ({
      id: String(u.id),
      unit_name: String(u.unit_name || ''),
      parent_id: u.parent_id ? String(u.parent_id) : null,
    }));

    const row = await prisma.orgUnit.findUnique({
      where: { id: myUnit.id },
      select: { id: true, unit_name: true, supply_storage_note: true },
    });

    const editScopeRaw = String(auth.permission?.editScope || 'NONE').toUpperCase();
    const editableUnits = resolveEditableUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      editScopeRaw
    );

    return NextResponse.json({
      unit_id: row?.id || myUnit.id,
      dept_name: row?.unit_name || myUnit.unit_name,
      note: row?.supply_storage_note || '',
      editableUnitIds: editableUnits.map((u) => u.id),
      editScope: editScopeRaw,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept GET]', error);
    return NextResponse.json({ error: '공유 메모 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/**
 * [PATCH] 부서 공유 메모 저장 (소모품 부서 메모와 동일 DB 필드)
 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const myUnit = auth.user.unit;
    if (!myUnit?.id || !myUnit.unit_name) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const allUnits = (auth.unitsList || []).map((u: any) => ({
      id: String(u.id),
      unit_name: String(u.unit_name || ''),
      parent_id: u.parent_id ? String(u.parent_id) : null,
    }));

    const editScopeRaw = String(auth.permission?.editScope || 'NONE').toUpperCase();
    const editableUnits = resolveEditableUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      editScopeRaw
    );

    if (editScopeRaw === 'NONE' || editableUnits.length === 0) {
      return NextResponse.json(
        { error: '공유 메모 수정 권한이 없습니다.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const unitId = String(body.unit_id || body.dept_id || myUnit.id).trim();
    const note = String(body.note ?? body.supply_storage_note ?? '');

    if (note.length > 4000) {
      return NextResponse.json(
        { error: '공유 메모는 4000자 이내로 작성해 주세요.' },
        { status: 400 }
      );
    }

    const target = editableUnits.find((u) => u.id === unitId);
    if (!target) {
      return NextResponse.json(
        { error: '해당 조직의 공유 메모는 수정할 수 없습니다.' },
        { status: 403 }
      );
    }

    const updated = await prisma.orgUnit.update({
      where: { id: target.id },
      data: { supply_storage_note: note },
      select: { id: true, unit_name: true, supply_storage_note: true },
    });

    return NextResponse.json({
      success: true,
      unit_id: updated.id,
      dept_name: updated.unit_name,
      note: updated.supply_storage_note || '',
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept PATCH]', error);
    return NextResponse.json({ error: '공유 메모 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
