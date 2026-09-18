import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  assertProductionRowInDeptScope,
  buildProductionDeptScopeWhere,
  isProductionScopeEmpty,
  withProductionDeptDisplayNames,
} from '@/lib/production-dept-scope';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/settlement';
const READ_PATHS = [
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
  '/asset/production/dept-master/settlement',
  '/asset/production/dept-master/archive',
  '/asset/production/master/dashboard',
];

type ScopeUnit = { id: string; unit_name: string };

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

function buildSettlementScope(auth: {
  user: { unit?: { id: string; unit_name: string } | null };
  unitsList?: unknown[];
  permission: { viewScope?: string; editScope?: string; myRole?: string; isMaster?: boolean };
}) {
  const myUnit = auth.user.unit;
  if (!myUnit?.id || !myUnit.unit_name) return null;

  const allUnits = (auth.unitsList || []).map((u: any) => ({
    id: u.id as string,
    unit_name: u.unit_name as string,
    parent_id: (u.parent_id ?? null) as string | null,
  }));

  const scopeKey =
    auth.permission.isMaster || auth.permission.myRole === 'LV_1'
      ? 'TOTAL'
      : String(auth.permission.editScope || auth.permission.viewScope || 'DEPT');

  return resolveScopeFromUnits(
    { id: myUnit.id, unit_name: myUnit.unit_name },
    allUnits,
    scopeKey
  );
}

function assertRowInDeptScope(
  scope: ReturnType<typeof resolveScopeFromUnits> | null,
  row: { unitId?: string | null; deptName?: string | null }
) {
  return assertProductionRowInDeptScope(scope, row);
}

/** [GET] 정산 대기·확정 묶음 (마스터 보관함 이관 전) */
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

    if (scope.viewScope === 'NONE' || isProductionScopeEmpty(scope)) {
      return NextResponse.json({
        batches: [],
        scopeUnits: scope.scopeUnits,
        myDeptName: scope.myUnit.unit_name,
        viewScope: scope.viewScope,
      });
    }

    const scopeWhere = buildProductionDeptScopeWhere(scope);
    const requests = await withProductionDeptDisplayNames(
      await prisma.productionRequest.findMany({
        where: {
          AND: [
            { isArchived: true },
            { status: 'VERIFIED' },
            { batchId: { not: null } },
            ...(scopeWhere ? [scopeWhere] : []),
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })
    );

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
          orderedAt: resolveBatchAppliedAt(items),
          dispatchedAt: resolveBatchDispatchedAt(items),
          archivedAt: archivedAt ? new Date(archivedAt).toISOString() : null,
          inspectStatus,
          inspectFileName,
          inspectResult,
          inspectedAt,
          masterSettledArchived:
            items.length > 0 && items.every((i) => isMasterSettledArchived(i.options)),
          items,
        };
      })
      .filter((b) => !b.masterSettledArchived)
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
    console.error('[production/dept-master/settlement GET]', error);
    return NextResponse.json({ error: '정산 목록 조회 실패' }, { status: 500 });
  }
}

/** [PUT] 명세서 검수 결과 저장 */
export async function PUT(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const scope = buildSettlementScope(auth);
    if (!scope || isProductionScopeEmpty(scope)) {
      return NextResponse.json(
        { message: '부서 스코프가 없어 처리할 수 없습니다.' },
        { status: 403 }
      );
    }
    const scopeWhere = buildProductionDeptScopeWhere(scope);

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
        where: {
          AND: [
            {
              batchId,
              isArchived: true,
              status: 'VERIFIED',
            },
            ...(scopeWhere ? [scopeWhere] : []),
          ],
        },
      });
      if (items.length === 0) continue;

      for (const item of items) {
        if (isMasterSettledArchived(item.options)) continue;
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

    if (count === 0) {
      return NextResponse.json(
        { message: '담당 부서 범위의 정산 대상 묶음이 없습니다.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, count });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/settlement PUT]', error);
    return NextResponse.json(
      { message: '검수 결과 저장 실패', error: error.message },
      { status: 500 }
    );
  }
}

/** [POST] 묶음 보관함 이관 / 명세표 대조(단가) 저장 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'inspect') {
      // body는 이미 파싱됨 — PUT(req) 재호출 시 본문 소실되므로 직접 처리
      const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
      const scope = buildSettlementScope(auth);
      if (!scope || isProductionScopeEmpty(scope)) {
        return NextResponse.json(
          { message: '부서 스코프가 없어 처리할 수 없습니다.' },
          { status: 403 }
        );
      }
      const scopeWhere = buildProductionDeptScopeWhere(scope);
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
          where: {
            AND: [
              {
                batchId,
                isArchived: true,
                status: 'VERIFIED',
              },
              ...(scopeWhere ? [scopeWhere] : []),
            ],
          },
        });
        if (items.length === 0) continue;

        for (const item of items) {
          if (isMasterSettledArchived(item.options)) continue;
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

      if (count === 0) {
        return NextResponse.json(
          { message: '담당 부서 범위의 정산 대상 묶음이 없습니다.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: true, count });
    }

    if (action === 'statement-match') {
      const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
      const scope = buildSettlementScope(auth);
      if (!scope || isProductionScopeEmpty(scope)) {
        return NextResponse.json(
          { message: '부서 스코프가 없어 처리할 수 없습니다.' },
          { status: 403 }
        );
      }
      const scopeWhere = buildProductionDeptScopeWhere(scope);

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

        const item = await prisma.productionRequest.findFirst({
          where: {
            AND: [
              {
                id: requestId,
                batchId,
                isArchived: true,
                status: 'VERIFIED',
              },
              ...(scopeWhere ? [scopeWhere] : []),
            ],
          },
          select: { options: true, unitId: true, deptName: true },
        });
        if (!item || !assertRowInDeptScope(scope, item)) continue;

        const prevOpts = asOptionsRecord(item.options);
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
          ...(inspectMatchedPrice != null
            ? { inspectMatchedPrice }
            : {}),
          ...(Array.isArray(row?.suppliesLineSettlements)
            ? { suppliesLineSettlements: row.suppliesLineSettlements }
            : {}),
        };

        const result = await prisma.productionRequest.updateMany({
          where: {
            AND: [
              {
                id: requestId,
                batchId,
                isArchived: true,
                status: 'VERIFIED',
              },
              ...(scopeWhere ? [scopeWhere] : []),
            ],
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
    }

    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const scope = buildSettlementScope(auth);
    if (!scope || isProductionScopeEmpty(scope)) {
      return NextResponse.json(
        { message: '부서 스코프가 없어 처리할 수 없습니다.' },
        { status: 403 }
      );
    }

    const batchId = String(body.batchId || '').trim();

    if (!batchId) {
      return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
    }

    const scopeWhere = buildProductionDeptScopeWhere(scope);
    const result = await prisma.productionRequest.updateMany({
      where: {
        AND: [
          {
            batchId,
            status: 'VERIFIED',
            isArchived: false,
          },
          ...(scopeWhere ? [scopeWhere] : []),
        ],
      },
      data: { isArchived: true },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { message: '담당 부서 범위의 수령완료(VERIFIED) 건만 보관함으로 이동할 수 있습니다.' },
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
    console.error('[production/dept-master/settlement POST]', error);
    return NextResponse.json({ message: '아카이브 이관 중 오류' }, { status: 500 });
  }
}
