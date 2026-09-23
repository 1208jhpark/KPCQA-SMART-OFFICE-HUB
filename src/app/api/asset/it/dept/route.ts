import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/it/dept';

type ScopeUnit = { id: string; unit_name: string };

/**
 * Access(viewScope) 기준 공유 메모 수정 가능 조직
 * - OWN: 본인만
 * - DEPT: 본인 + 직속 하위
 * - TOTAL: 본인 + 하위 전체
 * - NONE: 빈 목록
 */
function resolveAccessibleUnits(
  myUnit: { id: string; unit_name: string },
  allUnits: Array<{ id: string; unit_name: string; parent_id: string | null }>,
  viewScopeRaw: string
): ScopeUnit[] {
  const viewScope = String(viewScopeRaw || 'NONE').toUpperCase();
  const scopeUnits: ScopeUnit[] = [];
  const seen = new Set<string>();
  const push = (u: { id: string; unit_name: string } | null | undefined) => {
    if (!u?.id || !u.unit_name || seen.has(u.id)) return;
    seen.add(u.id);
    scopeUnits.push({ id: u.id, unit_name: u.unit_name });
  };

  if (viewScope === 'NONE') return [];

  push({ id: myUnit.id, unit_name: myUnit.unit_name });
  if (viewScope === 'OWN') return scopeUnits;

  if (viewScope === 'DEPT') {
    allUnits
      .filter((u) => u.parent_id === myUnit.id)
      .forEach((c) => push(c));
  } else if (viewScope === 'TOTAL') {
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
 * 수정 가능 범위 = Access(viewScope) — Edit 불필요
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

    const viewScopeRaw = String(auth.permission?.viewScope || 'NONE').toUpperCase();
    const accessibleUnits = resolveAccessibleUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      viewScopeRaw
    );

    return NextResponse.json({
      unit_id: row?.id || myUnit.id,
      dept_name: row?.unit_name || myUnit.unit_name,
      note: row?.supply_storage_note || '',
      // 하위 호환: editableUnitIds = Access 범위 (메모 수정용)
      editableUnitIds: accessibleUnits.map((u) => u.id),
      accessibleUnitIds: accessibleUnits.map((u) => u.id),
      viewScope: viewScopeRaw,
      editScope: String(auth.permission?.editScope || 'NONE').toUpperCase(),
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[asset/it/dept GET]', error);
    return NextResponse.json({ error: '공유 메모 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/**
 * [PATCH] 부서 공유 메모 저장 — 메뉴 Access + viewScope 내 조직 (Edit 불필요)
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

    const viewScopeRaw = String(auth.permission?.viewScope || 'NONE').toUpperCase();
    const accessibleUnits = resolveAccessibleUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      viewScopeRaw
    );

    if (viewScopeRaw === 'NONE' || accessibleUnits.length === 0) {
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

    const target = accessibleUnits.find((u) => u.id === unitId);
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
