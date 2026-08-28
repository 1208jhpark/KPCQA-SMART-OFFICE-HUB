import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/inspection';
const READ_PATHS = [
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

type ScopeUnit = { id: string; unit_name: string };

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

/** [GET] 묶음 발주(ORDERED+) 건 → 외주 발주 묶음 관리 대장 */
export async function GET() {
  try {
    const auth = await authorizeAnyMenuPaths(READ_PATHS);

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

    if (scope.viewScope === 'NONE' || scope.scopeNames.length === 0) {
      return NextResponse.json({
        batches: [],
        scopeUnits: scope.scopeUnits,
        myDeptName: scope.myUnit.unit_name,
        viewScope: scope.viewScope,
      });
    }

    const requests = await prisma.productionRequest.findMany({
      where: {
        isArchived: false,
        deptName: { in: scope.scopeNames },
        status: { in: ['ORDERED', 'VERIFIED'] },
        batchId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byBatch = new Map<string, typeof requests>();
    for (const row of requests) {
      const key = String(row.batchId || '').trim();
      if (!key) continue;
      const list = byBatch.get(key) || [];
      list.push(row);
      byBatch.set(key, list);
    }

    const batches = Array.from(byBatch.entries())
      .map(([id, items]) => {
        const vendors = Array.from(
          new Set(
            items
              .map((i) => {
                const opts = i.options as Record<string, unknown> | null;
                return opts && typeof opts.vendor === 'string' ? opts.vendor : '';
              })
              .filter(Boolean)
          )
        );
        const allVerified = items.length > 0 && items.every((i) => i.status === 'VERIFIED');
        const orderedAt = items.reduce((max, i) => {
          const t = new Date(i.updatedAt || i.createdAt).getTime();
          return t > max ? t : max;
        }, 0);
        return {
          id,
          status: allVerified ? 'VERIFIED' : 'ORDERED',
          totalCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0),
          vendors,
          orderedAt: orderedAt ? new Date(orderedAt).toISOString() : null,
          items,
        };
      })
      .sort((a, b) => {
        const ta = a.orderedAt ? new Date(a.orderedAt).getTime() : 0;
        const tb = b.orderedAt ? new Date(b.orderedAt).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({
      batches,
      scopeUnits: scope.scopeUnits,
      myDeptName: scope.myUnit.unit_name,
      viewScope: scope.viewScope,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/inspection GET]', error);
    return NextResponse.json({ error: '발주 묶음 조회 실패' }, { status: 500 });
  }
}

/** [POST] 단가 승인 / 발주 취소 / 보관함 이동 */
export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'cancel-batch') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      const result = await prisma.productionRequest.updateMany({
        where: { batchId, status: 'ORDERED', isArchived: false },
        data: { status: 'ACCEPTED', batchId: null },
      });
      if (result.count === 0) {
        return NextResponse.json(
          { message: '발주완료(미정산) 건만 취소할 수 있습니다.' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        message: `${result.count}건 발주를 취소하고 발주대기열로 되돌렸습니다.`,
        count: result.count,
      });
    }

    if (action === 'archive-batch') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      const result = await prisma.productionRequest.updateMany({
        where: { batchId, status: 'VERIFIED', isArchived: false },
        data: { isArchived: true },
      });
      if (result.count === 0) {
        return NextResponse.json(
          { message: '정산승인(VERIFIED) 건만 보관함으로 이동할 수 있습니다.' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        message: '해당 발주 묶음이 성공적으로 보관함으로 이관되었습니다.',
        count: result.count,
      });
    }

    const { requestId, finalPrice } = body;
    if (!requestId || finalPrice === undefined) {
      return NextResponse.json({ message: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const updatedRequest = await prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        finalPrice: Number(finalPrice),
        status: 'VERIFIED',
      },
    });

    return NextResponse.json({
      message: '성공적으로 정산 단가 대조가 승인되었습니다.',
      data: updatedRequest,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/inspection POST]', error);
    return NextResponse.json({ message: '검증 처리 중 오류' }, { status: 500 });
  }
}
