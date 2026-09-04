import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/master/dashboard';
const READ_PATHS = [
  '/asset/production/master/dashboard',
  '/asset/production/master/archive',
  '/asset/production/master/invoice',
];

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

function resolveBatchAppliedAt(
  items: Array<{ createdAt: Date; updatedAt: Date; options: unknown }>
) {
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

/**
 * [GET] 전사 검수완료 보관함 — 부서 archive와 동일 스키마, 스코프 제한 없음
 * (각 부서에서 수령 완료 후 보관함 이관된 묶음)
 */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);

    const requests = await prisma.productionRequest.findMany({
      where: {
        isArchived: true,
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
        const depts = Array.from(
          new Set(items.map((i) => String(i.deptName || '').trim()).filter(Boolean))
        );
        const deptHeads = Array.from(
          new Set(items.map((i) => String(i.deptHead || '').trim()).filter(Boolean))
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
          depts,
          deptHeads,
          orderedAt: resolveBatchAppliedAt(items),
          dispatchedAt: resolveBatchDispatchedAt(items),
          archivedAt: archivedAt ? new Date(archivedAt).toISOString() : null,
          items,
        };
      })
      .sort((a, b) => {
        const ta = a.archivedAt
          ? new Date(a.archivedAt).getTime()
          : a.dispatchedAt
            ? new Date(a.dispatchedAt).getTime()
            : 0;
        const tb = b.archivedAt
          ? new Date(b.archivedAt).getTime()
          : b.dispatchedAt
            ? new Date(b.dispatchedAt).getTime()
            : 0;
        return tb - ta;
      });

    return NextResponse.json({
      batches,
      viewScope: 'TOTAL',
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/master/dashboard GET]', error);
    return NextResponse.json({ error: '마스터 보관함 조회 실패' }, { status: 500 });
  }
}

/** [POST] 명세표 대조(단가) 저장 — 정산 상태 */
export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    if (action !== 'statement-match') {
      return NextResponse.json({ message: '지원하지 않는 작업입니다.' }, { status: 400 });
    }

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
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/master/dashboard POST]', error);
    return NextResponse.json({ message: '정산 대조 저장 중 오류' }, { status: 500 });
  }
}
