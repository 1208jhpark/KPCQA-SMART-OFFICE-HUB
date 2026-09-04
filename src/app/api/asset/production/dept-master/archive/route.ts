import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/archive';
const READ_PATHS = [
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/archive',
];

type ScopeUnit = { id: string; unit_name: string };

function asOptionsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function resolveBatchDispatchedAt(items: Array<{ options: unknown }>) {
  const times = items
    .map((i) => {
      const opts = asOptionsRecord(i.options);
      if (opts.vendorDispatched !== true) return 0;
      const raw = opts.vendorDispatchedAt;
      return raw ? new Date(String(raw)).getTime() : 0;
    })
    .filter((t) => t > 0);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

function resolveBatchAppliedAt(items: Array<{ createdAt: Date; updatedAt: Date; options: unknown }>) {
  const fromOpts = items
    .map((i) => {
      const raw = asOptionsRecord(i.options).batchOrderedAt;
      const t = raw ? new Date(String(raw)).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    })
    .filter((t) => t > 0);
  if (fromOpts.length > 0) return new Date(Math.min(...fromOpts)).toISOString();
  const updated = items
    .map((i) => new Date(i.updatedAt || i.createdAt).getTime())
    .filter((t) => t > 0);
  return updated.length > 0 ? new Date(Math.min(...updated)).toISOString() : null;
}

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

/** [GET] 검수 완료 후 보관함으로 이관된 묶음 */
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
        isArchived: true,
        deptName: { in: scope.scopeNames },
        status: 'VERIFIED',
        batchId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
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
        const archivedAt = items.reduce((max, i) => {
          const t = new Date(i.updatedAt || i.createdAt).getTime();
          return t > max ? t : max;
        }, 0);
        return {
          id,
          status: 'VERIFIED',
          totalCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0),
          vendors,
          orderedAt: resolveBatchAppliedAt(items),
          dispatchedAt: resolveBatchDispatchedAt(items),
          archivedAt: archivedAt ? new Date(archivedAt).toISOString() : null,
          items,
        };
      })
      .sort((a, b) => {
        const ta = a.dispatchedAt
          ? new Date(a.dispatchedAt).getTime()
          : a.archivedAt
            ? new Date(a.archivedAt).getTime()
            : 0;
        const tb = b.dispatchedAt
          ? new Date(b.dispatchedAt).getTime()
          : b.archivedAt
            ? new Date(b.archivedAt).getTime()
            : 0;
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
    console.error('[production/dept-master/archive GET]', error);
    return NextResponse.json({ error: '보관함 조회 실패' }, { status: 500 });
  }
}

/** [POST] 묶음 보관함 이관 / 명세표 대조(단가) 저장 */
export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'statement-match') {
      const batchId = String(body.batchId || '').trim();
      const prices = Array.isArray(body.prices) ? body.prices : [];
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      if (prices.length === 0) {
        return NextResponse.json({ message: '대조할 단가 정보가 없습니다.' }, { status: 400 });
      }

      let updated = 0;
      for (const row of prices) {
        const requestId = String(row?.requestId || '').trim();
        if (!requestId) continue;
        const finalPrice = Number(row?.finalPrice);
        if (!Number.isFinite(finalPrice) || finalPrice < 0) continue;
        const result = await prisma.productionRequest.updateMany({
          where: {
            id: requestId,
            batchId,
            isArchived: true,
            status: 'VERIFIED',
          },
          data: { finalPrice },
        });
        updated += result.count;
      }

      return NextResponse.json({
        message: `${updated}건 명세표 대조(단가)를 저장했습니다.`,
        count: updated,
      });
    }

    const batchId = String(body.batchId || '').trim();

    if (!batchId) {
      return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
    }

    const result = await prisma.productionRequest.updateMany({
      where: {
        batchId,
        status: 'VERIFIED',
        isArchived: false,
      },
      data: { isArchived: true },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { message: '수령완료(VERIFIED) 건만 보관함으로 이동할 수 있습니다.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: '해당 발주 묶음이 성공적으로 보관함으로 이관되었습니다.',
      count: result.count,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/archive POST]', error);
    return NextResponse.json({ message: '아카이브 이관 중 오류' }, { status: 500 });
  }
}
