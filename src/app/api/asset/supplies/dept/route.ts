import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { migrateLegacySupplyRequestStatus } from '@/lib/migrateSupplyRequestStatus';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/dept';

type ScopeUnit = { id: string; unit_name: string };

/** 세션 유저 기준 연계 조직 (상위1 + 본인 + 하위) */
async function resolveScope(userId: string): Promise<{
  myUnit: { id: string; unit_name: string };
  scopeUnits: ScopeUnit[];
  scopeNames: string[];
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { unit: { include: { parent: true } } },
  });
  if (!user?.unit) return null;

  const myUnit = user.unit;
  const scopeUnits: ScopeUnit[] = [];
  const seen = new Set<string>();

  const push = (u: { id: string; unit_name: string } | null | undefined) => {
    if (!u?.id || !u.unit_name || seen.has(u.id)) return;
    seen.add(u.id);
    scopeUnits.push({ id: u.id, unit_name: u.unit_name });
  };

  const allUnits = await prisma.orgUnit.findMany({
    where: { is_active: true, is_deleted: false },
    select: { id: true, unit_name: true, parent_id: true },
  });

  if (myUnit.parent_id) {
    const parent =
      myUnit.parent ||
      allUnits.find((u) => u.id === myUnit.parent_id) ||
      null;
    if (parent) push({ id: parent.id, unit_name: parent.unit_name });
  }
  push({ id: myUnit.id, unit_name: myUnit.unit_name });

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

  if (scopeUnits.length === 0) {
    push({ id: myUnit.id, unit_name: myUnit.unit_name });
  }

  return {
    myUnit: { id: myUnit.id, unit_name: myUnit.unit_name },
    scopeUnits,
    scopeNames: scopeUnits.map((u) => u.unit_name),
  };
}

/**
 * [GET] 부서 소모품 신청 내역 + 연계 조직 보관 메모
 * - 메뉴 접근만 필요 (편집 권한 불필요)
 */
export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    await migrateLegacySupplyRequestStatus();

    const scope = await resolveScope(auth.user.id);
    if (!scope) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const [myDeptRequests, noteRows] = await Promise.all([
      prisma.supplyRequest.findMany({
        where: { dept_name: { in: scope.scopeNames } },
        include: {
          item: {
            select: { name: true, image_url: true, description: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.orgUnit.findMany({
        where: { id: { in: scope.scopeUnits.map((u) => u.id) } },
        select: { unit_name: true, supply_storage_note: true },
      }),
    ]);

    const storageNotes: Record<string, string> = {};
    for (const row of noteRows) {
      storageNotes[row.unit_name] = row.supply_storage_note || '';
    }

    return NextResponse.json({
      requests: myDeptRequests,
      scopeDepts: scope.scopeNames,
      myDeptName: scope.myUnit.unit_name,
      storageNotes,
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
 * - 메뉴 접근자 모두 가능 (requireEditor 없음)
 * - 본인 연계 스코프 내 조직만 수정 가능
 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const scope = await resolveScope(auth.user.id);
    if (!scope) {
      return NextResponse.json(
        { error: '부서 정보가 등록되지 않은 사용자입니다.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const deptName = String(body.dept_name || body.deptName || '').trim();
    const note = String(body.note ?? body.supply_storage_note ?? '');

    if (!deptName) {
      return NextResponse.json({ error: '조직명이 필요합니다.' }, { status: 400 });
    }

    const target = scope.scopeUnits.find((u) => u.unit_name === deptName);
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
      select: { unit_name: true, supply_storage_note: true },
    });

    return NextResponse.json({
      success: true,
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
