import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  isCustomerDirectShip,
  withVendorDispatched,
} from '@/lib/production-shipping';
import {
  getOfficeQuoteLinesFromOptions,
  applyOfficeQuoteLinesToOptions,
  normalizeOfficeQuoteLines,
} from '@/lib/production-office-statement-match';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/inspection';
const READ_PATHS = [
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
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
  return value as Prisma.InputJsonValue;
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

  // 레거시: 발주확정 전이면 updatedAt, 확정 후면 createdAt 대신 최소 updatedAt 추정 불가 → createdAt 폴백 지양
  // vendorDispatchedAt 이 있으면 그보다 이전의 updatedAt 후보가 없으므로 항목 최초 생성일 중 최신(묶음 시점 근사) 사용
  const dispatchedAts = items
    .map((i) => {
      const opts = asOptionsRecord(i.options);
      if (opts.vendorDispatched !== true) return 0;
      const raw = opts.vendorDispatchedAt;
      return raw ? new Date(String(raw)).getTime() : 0;
    })
    .filter((t) => t > 0);
  if (dispatchedAts.length > 0) {
    const minDispatch = Math.min(...dispatchedAts);
    const beforeDispatch = items
      .map((i) => new Date(i.updatedAt || i.createdAt).getTime())
      .filter((t) => t > 0 && t < minDispatch);
    if (beforeDispatch.length > 0) return new Date(Math.max(...beforeDispatch)).toISOString();
  }

  const updated = items
    .map((i) => new Date(i.updatedAt || i.createdAt).getTime())
    .filter((t) => t > 0);
  return updated.length > 0 ? new Date(Math.min(...updated)).toISOString() : null;
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
        const orderedAt = resolveBatchAppliedAt(items);
        const dispatchedAt = resolveBatchDispatchedAt(items);
        return {
          id,
          status: allVerified ? 'VERIFIED' : 'ORDERED',
          totalCount: items.length,
          totalQuantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0),
          vendors,
          orderedAt,
          dispatchedAt,
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

/** [POST] 외주 발주확인 / 수령완료 / 발주 취소 / 보관함 이동 / 단가승인 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'confirm-dispatch') {
      const batchId = String(body.batchId || '').trim();
      const dispatchedDate =
        typeof body.dispatchedDate === 'string' && body.dispatchedDate.trim()
          ? body.dispatchedDate.trim()
          : undefined;
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      const rows = await prisma.productionRequest.findMany({
        where: { batchId, status: 'ORDERED', isArchived: false },
      });
      if (rows.length === 0) {
        return NextResponse.json(
          { message: '발주진행(ORDERED) 건이 없습니다.' },
          { status: 400 }
        );
      }

      let dispatched = 0;
      let autoReceived = 0;
      for (const row of rows) {
        const prev = asOptionsRecord(row.options);
        if (prev.vendorDispatched === true) continue;
        const nextOpts = withVendorDispatched(prev, dispatchedDate);
        const direct = isCustomerDirectShip({
          category: row.category,
          options: nextOpts,
        });
        await prisma.productionRequest.update({
          where: { id: row.id },
          data: {
            options: asInputJson(nextOpts),
            ...(direct ? { status: 'VERIFIED' } : {}),
          },
        });
        dispatched += 1;
        if (direct) autoReceived += 1;
      }

      return NextResponse.json({
        message:
          autoReceived > 0
            ? `${dispatched}건 외주 발주완료 처리했습니다. (고객사 직발송 ${autoReceived}건은 수령절차 생략)`
            : `${dispatched}건 외주 발주완료 처리했습니다.`,
        count: dispatched,
        autoReceived,
      });
    }

    if (action === 'confirm-receive') {
      const requestId = String(body.requestId || '').trim();
      if (!requestId) {
        return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
      }
      const row = await prisma.productionRequest.findUnique({ where: { id: requestId } });
      if (!row || row.isArchived || row.status !== 'ORDERED') {
        return NextResponse.json(
          { message: '수령대기(발주확정 후) 상태의 건만 수령완료할 수 있습니다.' },
          { status: 400 }
        );
      }
      const opts = asOptionsRecord(row.options);
      if (opts.vendorDispatched !== true) {
        return NextResponse.json(
          { message: '묶음 「발주확정」 처리 후 수령확인할 수 있습니다.' },
          { status: 400 }
        );
      }
      if (isCustomerDirectShip({ category: row.category, options: opts })) {
        return NextResponse.json(
          { message: '고객사 직발송 건은 수령검수가 필요하지 않습니다.' },
          { status: 400 }
        );
      }

      const quoteLines =
        String(row.category || '').toUpperCase() === 'OFFICE_SUPPLIES'
          ? getOfficeQuoteLinesFromOptions(opts)
          : [];
      const nextOpts =
        quoteLines.length > 0
          ? {
              ...opts,
              suppliesReceivedLineNos: quoteLines.map((l) => l.lineNo),
            }
          : opts;

      await prisma.productionRequest.update({
        where: { id: requestId },
        data: {
          status: 'VERIFIED',
          ...(quoteLines.length > 0 ? { options: asInputJson(nextOpts) } : {}),
        },
      });
      return NextResponse.json({ message: '수령완료 처리되었습니다.', id: requestId });
    }

    if (action === 'confirm-receive-line') {
      const requestId = String(body.requestId || '').trim();
      const lineNo = Number(body.lineNo);
      const received = body.received !== false;
      if (!requestId || !Number.isFinite(lineNo) || lineNo <= 0) {
        return NextResponse.json(
          { message: '신청 ID와 견적 줄번호가 필요합니다.' },
          { status: 400 }
        );
      }

      const row = await prisma.productionRequest.findUnique({ where: { id: requestId } });
      if (!row || row.isArchived) {
        return NextResponse.json({ message: '신청 건을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (String(row.category || '').toUpperCase() !== 'OFFICE_SUPPLIES') {
        return NextResponse.json(
          { message: '줄 단위 수령은 사무문구류만 지원합니다.' },
          { status: 400 }
        );
      }
      if (row.status !== 'ORDERED' && row.status !== 'VERIFIED') {
        return NextResponse.json(
          { message: '발주진행/수령완료 상태에서만 줄 수령을 변경할 수 있습니다.' },
          { status: 400 }
        );
      }

      const opts = asOptionsRecord(row.options);
      if (opts.vendorDispatched !== true && row.status !== 'VERIFIED') {
        return NextResponse.json(
          { message: '묶음 「발주완료」 처리 후 수령할 수 있습니다.' },
          { status: 400 }
        );
      }
      if (isCustomerDirectShip({ category: row.category, options: opts })) {
        return NextResponse.json(
          { message: '고객사 직발송 건은 수령검수가 필요하지 않습니다.' },
          { status: 400 }
        );
      }

      const quoteLines = getOfficeQuoteLinesFromOptions(opts);
      if (quoteLines.length === 0) {
        return NextResponse.json(
          { message: '견적 붙여넣기에서 제품 리스트를 파싱하지 못했습니다.' },
          { status: 400 }
        );
      }
      if (!quoteLines.some((l) => l.lineNo === lineNo)) {
        return NextResponse.json(
          { message: `견적 ${lineNo}번 줄을 찾을 수 없습니다.` },
          { status: 400 }
        );
      }

      const set = new Set(
        (Array.isArray(opts.suppliesReceivedLineNos) ? opts.suppliesReceivedLineNos : [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
      // 이미 신청건 VERIFIED면 전체 줄 수령으로 간주한 뒤 부분 해제 허용
      if (row.status === 'VERIFIED' && set.size === 0) {
        quoteLines.forEach((l) => set.add(l.lineNo));
      }
      if (received) set.add(lineNo);
      else set.delete(lineNo);

      const allReceived = quoteLines.every((l) => set.has(l.lineNo));
      const nextOpts = {
        ...opts,
        suppliesReceivedLineNos: Array.from(set).sort((a, b) => a - b),
      };

      await prisma.productionRequest.update({
        where: { id: requestId },
        data: {
          status: allReceived ? 'VERIFIED' : 'ORDERED',
          options: asInputJson(nextOpts),
        },
      });

      return NextResponse.json({
        message: allReceived
          ? '모든 품목 수령 · 신청건 수령확정되었습니다.'
          : received
            ? `${lineNo}번 품목 수령 체크했습니다.`
            : `${lineNo}번 품목 수령을 해제했습니다.`,
        id: requestId,
        allReceived,
        receivedCount: set.size,
        totalLines: quoteLines.length,
      });
    }

    if (action === 'save-office-quote-lines') {
      const requestId = String(body.requestId || '').trim();
      if (!requestId) {
        return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
      }
      const lines = normalizeOfficeQuoteLines(body.lines);
      if (lines.length === 0) {
        return NextResponse.json(
          { message: '저장할 제품 항목이 없습니다. 최소 1개 이상 입력해 주세요.' },
          { status: 400 }
        );
      }

      const row = await prisma.productionRequest.findUnique({ where: { id: requestId } });
      if (!row || row.isArchived) {
        return NextResponse.json(
          { message: '검수 중인 신청 건만 수정할 수 있습니다. (정산 이동 후에는 부서에서 수정 불가)' },
          { status: 400 }
        );
      }
      if (String(row.category || '').toUpperCase() !== 'OFFICE_SUPPLIES') {
        return NextResponse.json(
          { message: '사무문구류 견적 리스트만 수정할 수 있습니다.' },
          { status: 400 }
        );
      }
      if (row.status !== 'ORDERED' && row.status !== 'VERIFIED') {
        return NextResponse.json(
          { message: '발주진행/수령완료 상태에서만 수정할 수 있습니다.' },
          { status: 400 }
        );
      }

      const opts = asOptionsRecord(row.options);
      const nextOpts = applyOfficeQuoteLinesToOptions(opts, lines);
      const receivedNos = Array.isArray(nextOpts.suppliesReceivedLineNos)
        ? (nextOpts.suppliesReceivedLineNos as number[])
        : [];
      const allReceived =
        lines.length > 0 && lines.every((l) => receivedNos.includes(l.lineNo));

      await prisma.productionRequest.update({
        where: { id: requestId },
        data: {
          options: asInputJson(nextOpts),
          // 줄 수정으로 수령 체크가 깨지면 ORDERED로 되돌림
          status:
            row.status === 'VERIFIED' && !allReceived
              ? 'ORDERED'
              : row.status === 'ORDERED' && allReceived
                ? 'VERIFIED'
                : row.status,
        },
      });

      return NextResponse.json({
        message: `견적 리스트 ${lines.length}품목을 저장했습니다.`,
        id: requestId,
        lineCount: lines.length,
        updatedBy: String(auth.user?.name || '').trim() || undefined,
      });
    }

    if (action === 'cancel-batch') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      const rows = await prisma.productionRequest.findMany({
        where: {
          batchId,
          status: { in: ['ORDERED', 'VERIFIED'] },
          isArchived: false,
        },
      });
      if (rows.length === 0) {
        return NextResponse.json(
          { message: '발주진행·수령완료 건만 취소할 수 있습니다.' },
          { status: 400 }
        );
      }
      for (const row of rows) {
        const prev = asOptionsRecord(row.options);
        const { vendorDispatched: _vd, vendorDispatchedAt: _at, _backupShipping, ...rest } = prev;
        let restoredOptions = { ...rest };
        if (_backupShipping && typeof _backupShipping === 'object') {
          const b = _backupShipping as Record<string, unknown>;
          restoredOptions = {
            ...restoredOptions,
            receiverName: b.receiverName ?? '',
            receiverPhone: b.receiverPhone ?? '',
            shippingZipCode: b.shippingZipCode ?? '',
            shippingAddressRoad: b.shippingAddressRoad ?? '',
            shippingAddressDetail: b.shippingAddressDetail ?? '',
            shippingAddress: b.shippingAddress ?? '',
            companyAddressLabel: b.companyAddressLabel ?? '',
            selectedCompanyAddressId: b.selectedCompanyAddressId ?? '',
            deliveryMode: b.deliveryMode ?? undefined,
            jebonBatchShipping: b.jebonBatchShipping ?? undefined,
          };
        }
        await prisma.productionRequest.update({
          where: { id: row.id },
          data: {
            status: 'ACCEPTED',
            batchId: null,
            options: asInputJson(restoredOptions),
          },
        });
      }
      return NextResponse.json({
        message: `${rows.length}건 발주를 취소하고 발주대기열로 되돌렸습니다.`,
        count: rows.length,
      });
    }

    if (action === 'archive-batch') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
      }
      const rows = await prisma.productionRequest.findMany({
        where: { batchId, status: 'VERIFIED', isArchived: false },
      });
      if (rows.length === 0) {
        return NextResponse.json(
          { message: '수령완료(VERIFIED) 건만 보관함으로 이동할 수 있습니다.' },
          { status: 400 }
        );
      }

      const { getKSTDateString } = await import('@/utils/dateUtils');
      const settlementMovedBy = {
        date: getKSTDateString(),
        userName: String(auth.user?.name || '').trim() || '-',
        deptName: String(
          (auth.user as { unit?: { unit_name?: string | null } | null })?.unit?.unit_name || ''
        ).trim(),
      };
      const settlementMovedAt = new Date().toISOString();

      let updated = 0;
      for (const row of rows) {
        const prevOpts = asOptionsRecord(row.options);
        await prisma.productionRequest.update({
          where: { id: row.id },
          data: {
            isArchived: true,
            options: asInputJson({
              ...prevOpts,
              settlementMovedBy,
              settlementMovedAt,
            }),
          },
        });
        updated += 1;
      }

      return NextResponse.json({
        message: '해당 발주 묶음이 성공적으로 보관함으로 이관되었습니다.',
        count: updated,
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
