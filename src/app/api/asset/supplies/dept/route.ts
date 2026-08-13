import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/dept';

type ScopeUnit = { id: string; unit_name: string };

/**
 * 세션 유저 + viewScope 기준 연계 조직
 * - OWN: 본인 조직만
 * - DEPT: 본인 + 직속 하위 (상위 제외)
 * - TOTAL: 본인 + 하위 전체 (재귀, 상위 제외)
 * - NONE: 본인 조직만 (조회는 빈 목록)
 */
function resolveScopeFromUnits(
  myUnit: { id: string; unit_name: string },
  allUnits: Array<{ id: string; unit_name: string; parent_id: string | null }>,
  viewScopeRaw: string
): { myUnit: ScopeUnit; scopeUnits: ScopeUnit[]; scopeNames: string[]; viewScope: string } {
  const viewScope = String(viewScopeRaw || 'DEPT').toUpperCase();
  const scopeUnits: ScopeUnit[] = [];
  const seen = new Set<string>();

  const push = (u: { id: string; unit_name: string } | null | undefined) => {
    if (!u?.id || !u.unit_name || seen.has(u.id)) return;
    seen.add(u.id);
    scopeUnits.push({ id: u.id, unit_name: u.unit_name });
  };

  push({ id: myUnit.id, unit_name: myUnit.unit_name });

  if (viewScope === 'DEPT') {
    allUnits
      .filter((u) => u.parent_id === myUnit.id)
      .sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko'))
      .forEach((c) => push(c));
  } else if (viewScope === 'TOTAL') {
    const children: ScopeUnit[] = [];
    const walk = (parentId: string) => {
      allUnits
        .filter((u) => u.parent_id === parentId)
        .forEach((c) => {
          children.push({ id: c.id, unit_name: c.unit_name });
          walk(c.id);
        });
    };
    walk(myUnit.id);
    children
      .sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko'))
      .forEach((c) => push(c));
  }

  return {
    myUnit: { id: myUnit.id, unit_name: myUnit.unit_name },
    scopeUnits,
    scopeNames: scopeUnits.map((u) => u.unit_name),
    viewScope,
  };
}

/**
 * [GET] 부서 소모품 신청 내역 + 연계 조직 보관 메모
 * - unit_id 우선 스코프, 레거시(null)는 dept_name / user_email 폴백
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
      id: u.id as string,
      unit_name: u.unit_name as string,
      parent_id: (u.parent_id ?? null) as string | null,
    }));

    const scope = resolveScopeFromUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      auth.permission.viewScope
    );

    if (scope.viewScope === 'NONE') {
      return NextResponse.json({
        requests: [],
        scopeDepts: scope.scopeNames,
        scopeUnits: scope.scopeUnits,
        myDeptName: scope.myUnit.unit_name,
        myUnitId: scope.myUnit.id,
        storageNotes: {},
        storageNotesByUnitId: {},
        viewScope: scope.viewScope,
        editScope: String(auth.permission.editScope || 'NONE').toUpperCase(),
        editableUnitIds: [],
      });
    }

    const editScopeRaw = String(auth.permission.editScope || 'NONE').toUpperCase();
    const editScopeResolved = resolveScopeFromUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      editScopeRaw
    );
    const editableUnitIds =
      editScopeRaw === 'NONE'
        ? []
        : editScopeResolved.scopeUnits.map((u) => u.id);

    const scopeIds = scope.scopeUnits.map((u) => u.id);

    let requestWhere: Record<string, unknown> | null = null;
    if (scope.viewScope === 'OWN') {
      requestWhere = { user_email: auth.user.email };
    } else {
      const usersInScope = await prisma.user.findMany({
        where: { unit_id: { in: scopeIds } },
        select: { email: true },
      });
      const scopeEmails = usersInScope.map((u) => u.email).filter(Boolean);

      const orClauses: Record<string, unknown>[] = [
        { unit_id: { in: scopeIds } },
      ];
      // 레거시: unit_id 없는 행만 이름/이메일로 보완
      if (scope.scopeNames.length > 0) {
        orClauses.push({
          AND: [{ unit_id: null }, { dept_name: { in: scope.scopeNames } }],
        });
      }
      if (scopeEmails.length > 0) {
        orClauses.push({
          AND: [{ unit_id: null }, { user_email: { in: scopeEmails } }],
        });
      }
      requestWhere = { OR: orClauses };
    }

    const [myDeptRequests, noteRows] = await Promise.all([
      !requestWhere
        ? Promise.resolve([])
        : prisma.supplyRequest.findMany({
            where: requestWhere,
            include: {
              item: {
                select: { name: true, description: true },
              },
              unit: { select: { id: true, unit_name: true } },
            },
            orderBy: { createdAt: 'desc' },
          }),
      prisma.orgUnit.findMany({
        where: { id: { in: scopeIds } },
        select: { id: true, unit_name: true, supply_storage_note: true },
      }),
    ]);

    const storageNotes: Record<string, string> = {};
    const storageNotesByUnitId: Record<string, string> = {};
    for (const row of noteRows) {
      storageNotes[row.unit_name] = row.supply_storage_note || '';
      storageNotesByUnitId[row.id] = row.supply_storage_note || '';
    }

    // 클라에 OrgUnit 객체를 넣지 않음 — {id,unit_name}이 JSX 자식으로 새는 런타임 오류 방지
    const requests = myDeptRequests.map((r: any) => {
      const { unit, ...rest } = r;
      return {
        ...rest,
        unit_id: rest.unit_id || unit?.id || null,
        // 표시용 스냅샷: 현재 조직명 우선, 없으면 신청 시점 dept_name
        dept_name: unit?.unit_name || rest.dept_name || '',
      };
    });

    return NextResponse.json({
      requests,
      scopeDepts: scope.scopeNames,
      scopeUnits: scope.scopeUnits,
      myDeptName: scope.myUnit.unit_name,
      myUnitId: scope.myUnit.id,
      storageNotes,
      storageNotesByUnitId,
      viewScope: scope.viewScope,
      editScope: editScopeRaw,
      editableUnitIds,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/dept GET]', error);
    return NextResponse.json(
      { error: '데이터를 불러오는 중 서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * [PATCH] 부서 소모품 보관 위치 메모 저장
 * - Access(조회) 통과 + Editor만 가능 (authorizeApi requireEditor)
 * - 수정 가능 조직 범위는 editScope (viewScope가 아님)
 * - unit_id 우선, 없으면 unit_name
 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });

    const myUnit = auth.user.unit;
    if (!myUnit?.id || !myUnit.unit_name) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const allUnits = (auth.unitsList || []).map((u: any) => ({
      id: u.id as string,
      unit_name: u.unit_name as string,
      parent_id: (u.parent_id ?? null) as string | null,
    }));

    const editScopeRaw = String(auth.permission.editScope || 'NONE').toUpperCase();
    const scope = resolveScopeFromUnits(
      { id: myUnit.id, unit_name: myUnit.unit_name },
      allUnits,
      editScopeRaw
    );

    if (editScopeRaw === 'NONE' || scope.viewScope === 'NONE') {
      return NextResponse.json(
        { error: '해당 조직의 보관 안내는 수정할 수 없습니다.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const unitId = String(body.unit_id || body.dept_id || '').trim();
    const deptName = String(body.dept_name || body.deptName || '').trim();
    const note = String(body.note ?? body.supply_storage_note ?? '');

    if (!unitId && !deptName) {
      return NextResponse.json(
        { error: '조직(단위) 식별자가 필요합니다.' },
        { status: 400 }
      );
    }

    const target = unitId
      ? scope.scopeUnits.find((u) => u.id === unitId)
      : scope.scopeUnits.find((u) => u.unit_name === deptName);

    if (!target) {
      return NextResponse.json(
        { error: '해당 조직의 보관 안내는 수정할 수 없습니다.' },
        { status: 403 }
      );
    }

    if (note.length > 4000) {
      return NextResponse.json(
        { error: '보관 안내는 4000자 이내로 작성해 주세요.' },
        { status: 400 }
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
    console.error('[supplies/dept PATCH]', error);
    return NextResponse.json(
      { error: '보관 안내 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
