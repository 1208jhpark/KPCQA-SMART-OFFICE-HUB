import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
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
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
];

function asOptionsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function isMasterSettledArchived(options: unknown): boolean {
  return asOptionsRecord(options).masterSettledArchived === true;
}

function isBatchSettled(items: Array<{ finalPrice?: number | null; options: unknown }>): boolean {
  if (items.length === 0) return false;
  const statuses = items.map((i) => {
    const opts = asOptionsRecord(i.options);
    return typeof opts.inspectStatus === 'string' ? opts.inspectStatus : 'idle';
  });
  if (statuses.every((s) => s === 'match')) return true;
  return items.every((i) => i.finalPrice != null && Number(i.finalPrice) > 0);
}

/** 묶음 내 행 순서 고정 — updatedAt 갱신(대조 저장 등)에 흔들리지 않게 */
function sortBatchItemsStable<
  T extends { id: string; createdAt: Date | string; postNumber?: string | null },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    const pa = String(a.postNumber || '');
    const pb = String(b.postNumber || '');
    if (pa !== pb) return pa.localeCompare(pb, 'ko');
    return String(a.id).localeCompare(String(b.id));
  });
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
 * ?view=settled-archive → 마스터 정산완료 아카이브(보관함 이동 완료분)
 */
export async function GET(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const view = new URL(req.url).searchParams.get('view') || '';
    const settledArchiveOnly = view === 'settled-archive';

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
      .map(([id, rawItems]) => {
        const items = sortBatchItemsStable(rawItems);
        const masterSettledArchived =
          items.length > 0 && items.every((i) => isMasterSettledArchived(i.options));
        if (settledArchiveOnly ? !masterSettledArchived : masterSettledArchived) {
          return null;
        }
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
        // 대조 저장으로 updatedAt이 바뀌어도 묶음 시각·행순서가 흔들리지 않게 createdAt 기준
        const archivedAt = items.reduce((max, i) => {
          const t = new Date(i.createdAt).getTime();
          return t > max ? t : max;
        }, 0);

        let inspectStatus: 'idle' | 'match' | 'mismatch' = 'idle';
        let inspectFileName: string | null = null;
        let inspectResult: any = null;
        let inspectedAt: string | null = null;

        const statuses = items.map((i) => {
          const opts = asOptionsRecord(i.options);
          if (!inspectFileName && opts.inspectFileName) inspectFileName = String(opts.inspectFileName);
          if (!inspectResult && opts.inspectResult) inspectResult = opts.inspectResult;
          if (!inspectedAt && opts.inspectedAt) inspectedAt = String(opts.inspectedAt);
          return typeof opts.inspectStatus === 'string' ? opts.inspectStatus : 'idle';
        });

        if (statuses.some((s) => s === 'mismatch')) {
          inspectStatus = 'mismatch';
        } else if (statuses.length > 0 && statuses.every((s) => s === 'match')) {
          inspectStatus = 'match';
        } else if (statuses.some((s) => s === 'match')) {
          inspectStatus = 'mismatch';
        } else {
          inspectStatus = 'idle';
        }

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
          inspectStatus,
          inspectFileName,
          inspectResult,
          inspectedAt,
          masterSettledArchived,
          items,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b != null)
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
      view: settledArchiveOnly ? 'settled-archive' : 'dashboard',
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/master/dashboard GET]', error);
    return NextResponse.json({ error: '마스터 보관함 조회 실패' }, { status: 500 });
  }
}

/** [PUT] 명세서 검수 결과 저장 */
export async function PUT(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const body = await req.json().catch(() => ({}));
    const rows: Array<{
      batchId: string;
      inspectStatus: 'idle' | 'match' | 'mismatch';
      inspectFileName?: string | null;
      inspectResult?: any;
    }> = Array.isArray(body?.batches) ? body.batches : [];

    if (rows.length === 0) {
      return NextResponse.json({ message: '저장할 검수 묶음이 없습니다.' }, { status: 400 });
    }

    let count = 0;
    for (const row of rows) {
      const batchId = String(row?.batchId || '').trim();
      if (!batchId) continue;
      const inspectStatus =
        row.inspectStatus === 'match' || row.inspectStatus === 'mismatch'
          ? row.inspectStatus
          : 'idle';
      const inspectFileName = row.inspectFileName
        ? String(row.inspectFileName).slice(0, 255)
        : null;
      const inspectResult = row.inspectResult ?? null;
      const inspectedAt = inspectStatus === 'idle' ? null : new Date().toISOString();

      const items = await prisma.productionRequest.findMany({
        where: { batchId },
      });

      for (const item of items) {
        const prevOpts = asOptionsRecord(item.options);
        const itemStatus = inspectResult?.itemStatus?.[item.id] || inspectStatus;
        const itemPrice = Number(inspectResult?.itemPrice?.[item.id] || 0);

        const nextOpts = {
          ...prevOpts,
          inspectStatus: itemStatus,
          inspectFileName,
          inspectResult,
          inspectedAt,
          ...(itemPrice > 0 ? { inspectMatchedPrice: itemPrice } : {}),
        };

        await prisma.productionRequest.update({
          where: { id: item.id },
          data: {
            options: asInputJson(nextOpts),
            ...(itemPrice > 0 ? { finalPrice: itemPrice } : {}),
          },
        });
      }
      count += 1;
    }

    return NextResponse.json({ success: true, count });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/master/dashboard PUT]', error);
    return NextResponse.json(
      { message: '검수 결과 저장 실패', error: error.message },
      { status: 500 }
    );
  }
}

/** [POST] 명세표 대조(단가) 저장 / 정산완료 아카이브 이관 / LV_1 테스트 데이터 영구삭제 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    // 정산완료 아카이브 테스트용 영구삭제 — LV_1 / 메뉴 Master 전용
    if (action === 'purge-archived-batches') {
      const auth = await authorizeAnyMenuPaths(
        ['/asset/production/master/archive', '/asset/production/master/dashboard'],
        { requireEditor: true }
      );
      const isLv1OrMaster =
        auth.permission.isMaster || auth.permission.myRole === 'LV_1';
      if (!isLv1OrMaster) {
        return NextResponse.json(
          { message: '영구삭제는 LV_1(마스터) 권한이 필요합니다.' },
          { status: 403 }
        );
      }

      const batchIds = Array.isArray(body.batchIds)
        ? body.batchIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : [];
      if (batchIds.length === 0) {
        return NextResponse.json({ message: '삭제할 묶음을 선택해 주세요.' }, { status: 400 });
      }

      const items = await prisma.productionRequest.findMany({
        where: { batchId: { in: batchIds } },
        select: { id: true, batchId: true, options: true },
      });
      const deletableIds = items
        .filter((i) => isMasterSettledArchived(i.options))
        .map((i) => i.id);

      if (deletableIds.length === 0) {
        return NextResponse.json(
          { message: '정산완료 아카이브 상태인 삭제 대상 건이 없습니다.' },
          { status: 404 }
        );
      }

      const result = await prisma.productionRequest.deleteMany({
        where: { id: { in: deletableIds } },
      });
      const deletedBatchCount = new Set(
        items.filter((i) => deletableIds.includes(i.id)).map((i) => i.batchId).filter(Boolean)
      ).size;

      return NextResponse.json({
        message: `정산완료 아카이브 ${deletedBatchCount}묶음(${result.count}건)을 영구삭제했습니다.`,
        count: result.count,
        batchCount: deletedBatchCount,
      });
    }

    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });

    if (action === 'inspect') {
      return PUT(req);
    }

    if (action === 'master-archive-batch') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }

      const items = await prisma.productionRequest.findMany({
        where: {
          batchId,
          isArchived: true,
          status: 'VERIFIED',
        },
      });
      if (items.length === 0) {
        return NextResponse.json({ message: '이관할 보관함 묶음을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (items.every((i) => isMasterSettledArchived(i.options))) {
        return NextResponse.json({ message: '이미 정산완료 아카이브로 이동된 묶음입니다.' }, { status: 400 });
      }
      if (!isBatchSettled(items)) {
        return NextResponse.json(
          { message: '정산확정된 묶음만 아카이브로 이동할 수 있습니다.' },
          { status: 400 }
        );
      }

      const { getKSTDateString } = await import('@/utils/dateUtils');
      const masterSettledArchivedAt = new Date().toISOString();
      const masterSettledArchivedBy = {
        date: getKSTDateString(),
        userName: String(auth.user?.name || '').trim() || '-',
        deptName: String(
          (auth.user as { unit?: { unit_name?: string | null } | null })?.unit?.unit_name || ''
        ).trim(),
      };

      let updated = 0;
      for (const item of items) {
        const prevOpts = asOptionsRecord(item.options);
        const nextOpts = {
          ...prevOpts,
          masterSettledArchived: true,
          masterSettledArchivedAt,
          masterSettledArchivedBy,
        };
        await prisma.productionRequest.update({
          where: { id: item.id },
          data: { options: asInputJson(nextOpts) },
        });
        updated += 1;
      }

      return NextResponse.json({
        message: `${updated}건을 정산완료 아카이브로 이동했습니다.`,
        count: updated,
      });
    }

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

    const { getKSTDateString } = await import('@/utils/dateUtils');
    const settlementLastEdit = {
      date: getKSTDateString(),
      userName: String(auth.user?.name || '').trim() || '-',
      deptName: String(
        (auth.user as { unit?: { unit_name?: string | null } | null })?.unit?.unit_name || ''
      ).trim(),
    };

    let updated = 0;
    for (const row of prices) {
      const requestId = String(row?.requestId || '').trim();
      if (!requestId) continue;
      const finalPrice = Number(row?.finalPrice);
      if (!Number.isFinite(finalPrice) || finalPrice < 0) continue;
      const baselineRaw = Number(row?.baselinePrice);
      const baselinePrice =
        Number.isFinite(baselineRaw) && baselineRaw > 0 ? Math.trunc(baselineRaw) : null;

      const item = await prisma.productionRequest.findUnique({
        where: { id: requestId },
        select: { options: true },
      });
      const prevOpts = asOptionsRecord(item?.options);
      if (prevOpts.masterSettledArchived === true) {
        continue;
      }
      const existingMatched = Number(prevOpts.inspectMatchedPrice);
      const inspectMatchedPrice =
        Number.isFinite(existingMatched) && existingMatched > 0
          ? Math.trunc(existingMatched)
          : baselinePrice;
      const nextOpts = {
        ...prevOpts,
        inspectStatus: finalPrice > 0 ? 'match' : prevOpts.inspectStatus || 'idle',
        settlementLastEdit,
        ...(inspectMatchedPrice != null ? { inspectMatchedPrice } : {}),
      };

      const result = await prisma.productionRequest.updateMany({
        where: {
          id: requestId,
          batchId,
          isArchived: true,
          status: 'VERIFIED',
        },
        data: {
          finalPrice,
          options: asInputJson(nextOpts),
        },
      });
      updated += result.count;
    }

    return NextResponse.json({
      message: `${updated}건 명세표 대조(단가)를 저장했습니다.`,
      count: updated,
      settlementLastEdit,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/master/dashboard POST]', error);
    return NextResponse.json({ message: '정산 대조 저장 중 오류' }, { status: 500 });
  }
}
