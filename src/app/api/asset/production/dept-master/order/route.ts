import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import {
  mergeBatchShippingIntoOptions,
  shouldApplyBatchShippingToItem,
  validateBatchShippingInput,
  type BatchShippingApplyScope,
  type BatchShippingInput,
} from '@/lib/production-shipping';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/dept-master/order';
const READ_PATHS = [
  '/asset/production/dept-master/order',
  '/asset/production/dept-master/inspection',
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

function formatBatchId(prefix: string, sequence: number) {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

/** 당일 부서별 기존 묶음 번호 최대값 다음 시퀀스 */
async function getNextBatchSequenceStart(deptName: string) {
  const todayStr = getKSTDateString().replace(/-/g, '');
  const prefix = `BATCH-${deptName}-${todayStr}`;
  const rows = await prisma.productionRequest.findMany({
    where: { batchId: { startsWith: prefix } },
    select: { batchId: true },
    distinct: ['batchId'],
  });
  let maxSeq = 0;
  for (const row of rows) {
    const matched = String(row.batchId || '').match(/-(\d{3})$/);
    if (matched) maxSeq = Math.max(maxSeq, parseInt(matched[1], 10));
  }
  return { prefix, startSeq: maxSeq + 1 };
}

async function applyBatchShippingToBatch(
  batchId: string,
  batchShipping: BatchShippingInput,
  batchShippingScope: BatchShippingApplyScope
) {
  const rows = await prisma.productionRequest.findMany({
    where: { batchId },
  });
  for (const row of rows) {
    if (
      !shouldApplyBatchShippingToItem(
        { category: row.category, options: asOptionsRecord(row.options) },
        batchShippingScope
      )
    ) {
      continue;
    }
    const prevOptions = asOptionsRecord(row.options);
    await prisma.productionRequest.update({
      where: { id: row.id },
      data: {
        options: asInputJson(mergeBatchShippingIntoOptions(prevOptions, batchShipping)),
      },
    });
  }
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

/** [GET] 연계 조직 제작 신청 내역 — apply/history DEPT 스코프와 동일 데이터 */
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
        requests: [],
        scopeUnits: scope.scopeUnits,
        myDeptName: scope.myUnit.unit_name,
        myUnitId: scope.myUnit.id,
        viewScope: scope.viewScope,
      });
    }

    const requests = await prisma.productionRequest.findMany({
      where: {
        isArchived: false,
        deptName: { in: scope.scopeNames },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      requests,
      scopeUnits: scope.scopeUnits,
      myDeptName: scope.myUnit.unit_name,
      myUnitId: scope.myUnit.id,
      viewScope: scope.viewScope,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/order GET]', error);
    return NextResponse.json({ error: '부서 제작 신청 내역 조회 실패' }, { status: 500 });
  }
}

/** [POST] 선택 건 묶음 발주 — ACCEPTED(발주대기) → ORDERED + batchId → inspection */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const requestIds = Array.isArray(body.requestIds)
      ? body.requestIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const batchShippingRaw = body.batchShipping;

    if (requestIds.length === 0) {
      return NextResponse.json({ message: '발주할 항목을 선택해주세요.' }, { status: 400 });
    }

    let batchShipping: BatchShippingInput | null = null;
    if (batchShippingRaw && typeof batchShippingRaw === 'object') {
      batchShipping = {
        receiverName: String((batchShippingRaw as BatchShippingInput).receiverName || ''),
        receiverPhone: String((batchShippingRaw as BatchShippingInput).receiverPhone || ''),
        shippingZipCode: String((batchShippingRaw as BatchShippingInput).shippingZipCode || ''),
        shippingAddressRoad: String(
          (batchShippingRaw as BatchShippingInput).shippingAddressRoad || ''
        ),
        shippingAddressDetail: String(
          (batchShippingRaw as BatchShippingInput).shippingAddressDetail || ''
        ),
        companyAddressLabel: String(
          (batchShippingRaw as BatchShippingInput).companyAddressLabel || ''
        ),
      };
      const shippingErr = validateBatchShippingInput(batchShipping);
      if (shippingErr) {
        return NextResponse.json({ message: shippingErr }, { status: 400 });
      }
    }

    const myUnit = auth.user.unit;
    const deptName = myUnit?.unit_name || '부서';

    const acceptedRows = await prisma.productionRequest.findMany({
      where: { id: { in: requestIds }, status: 'ACCEPTED' },
    });

    if (acceptedRows.length === 0) {
      return NextResponse.json(
        { message: '발주대기(접수완료) 상태인 건만 묶음 발주할 수 있습니다. 먼저 접수 처리해 주세요.' },
        { status: 400 }
      );
    }

    const batchShippingScope: BatchShippingApplyScope =
      body.batchShippingScope === 'all' ? 'all' : 'deferred';

    const printRows = acceptedRows.filter((r) => r.category === 'PRINT');
    const bundleRows = acceptedRows.filter((r) => r.category !== 'PRINT');
    const { prefix, startSeq } = await getNextBatchSequenceStart(deptName);
    const batchOrderedAt = new Date().toISOString();

    let nextSeq = startSeq;
    const tx: Prisma.PrismaPromise<unknown>[] = [];

    for (const row of printRows) {
      const prev = asOptionsRecord(row.options);
      tx.push(
        prisma.productionRequest.update({
          where: { id: row.id },
          data: {
            status: 'ORDERED',
            batchId: formatBatchId(prefix, nextSeq++),
            options: asInputJson({ ...prev, batchOrderedAt }),
          },
        })
      );
    }

    let bundleBatchId: string | null = null;
    if (bundleRows.length > 0) {
      bundleBatchId = formatBatchId(prefix, nextSeq);
      for (const row of bundleRows) {
        const prev = asOptionsRecord(row.options);
        tx.push(
          prisma.productionRequest.update({
            where: { id: row.id },
            data: {
              status: 'ORDERED',
              batchId: bundleBatchId,
              options: asInputJson({ ...prev, batchOrderedAt }),
            },
          })
        );
      }
    }

    await prisma.$transaction(tx);

    if (batchShipping && bundleBatchId) {
      await applyBatchShippingToBatch(bundleBatchId, batchShipping, batchShippingScope);
    }

    const printCount = printRows.length;
    const bundleCount = bundleRows.length;
    let message: string;
    if (printCount > 0 && bundleCount > 0) {
      message = `기타 제작물 ${printCount}건 개별 발주, 그 외 ${bundleCount}건 묶음 발주가 완료되었습니다.`;
    } else if (printCount > 0) {
      message = `${printCount}건 개별 발주 처리가 완료되었습니다. (기타 제작물은 건별 묶음으로 생성됩니다)`;
    } else {
      message = `${bundleCount}건 묶음 발주 처리가 완료되었습니다. 발주/수령 검수 탭에서 확인하세요.`;
    }

    return NextResponse.json({
      message,
      batchId: bundleBatchId || undefined,
      count: acceptedRows.length,
      redirectTo: '/asset/production/dept-master/inspection',
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/order POST]', error);
    return NextResponse.json({ message: '발주 처리 중 서버 오류' }, { status: 500 });
  }
}

/** [PATCH] 접수 / 반려 / 원문 수정(대기중·발주대기) */
export async function PATCH(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    const action = String(body.action || '').trim().toLowerCase();

    if (!id) {
      return NextResponse.json({ message: '신청 ID가 필요합니다.' }, { status: 400 });
    }

    const row = await prisma.productionRequest.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ message: '신청 내역을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (action === 'update') {
      if (row.status !== 'PENDING' && row.status !== 'ACCEPTED') {
        return NextResponse.json(
          { message: '대기중·발주대기 상태인 건만 원문을 수정할 수 있습니다.' },
          { status: 400 }
        );
      }
      const prevOptions = asOptionsRecord(row.options);
      const nextOptions =
        body.options && typeof body.options === 'object' && !Array.isArray(body.options)
          ? { ...prevOptions, ...(body.options as Record<string, unknown>) }
          : prevOptions;
      const title = body.title != null ? String(body.title).trim() : row.title;
      if (!title) {
        return NextResponse.json({ message: '관리용 제목은 필수입니다.' }, { status: 400 });
      }
      const quantity =
        body.quantity != null ? Math.max(1, Number(body.quantity) || 1) : row.quantity;

      const updated = await prisma.productionRequest.update({
        where: { id },
        data: { title, quantity, options: asInputJson(nextOptions) },
      });
      return NextResponse.json({ message: '수정이 저장되었습니다.', data: updated });
    }

    if (action === 'revert' || action === 'unaccept') {
      if (row.status !== 'ACCEPTED') {
        return NextResponse.json(
          { message: '발주대기(접수완료) 상태인 건만 접수 대기로 되돌릴 수 있습니다.' },
          { status: 400 }
        );
      }
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: { status: 'PENDING' },
      });
      return NextResponse.json({
        message: '접수를 취소하고 신청(접수 대기)으로 되돌렸습니다.',
        data: updated,
      });
    }

    if (row.status !== 'PENDING') {
      return NextResponse.json(
        { message: '대기중(미접수) 상태인 건만 접수·반려할 수 있습니다.' },
        { status: 400 }
      );
    }

    if (action === 'approve' || action === 'accept') {
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: { status: 'ACCEPTED' },
      });
      return NextResponse.json({
        message: '접수 완료 — 발주대기로 이동했습니다.',
        data: updated,
      });
    }

    if (action === 'reject') {
      const reason = String(body.rejectReason || body.reason || '').trim();
      if (!reason) {
        return NextResponse.json({ message: '반려 사유를 입력해 주세요.' }, { status: 400 });
      }
      const prevOpts =
        row.options && typeof row.options === 'object' && !Array.isArray(row.options)
          ? (row.options as Record<string, unknown>)
          : {};
      const updated = await prisma.productionRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          options: {
            ...prevOpts,
            rejectReason: reason,
            rejectedAt: getKSTDateString(),
          },
        },
      });
      return NextResponse.json({
        message: '반려 처리했습니다.',
        data: updated,
      });
    }

    return NextResponse.json({ message: '지원하지 않는 동작입니다.' }, { status: 400 });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[production/dept-master/order PATCH]', error);
    return NextResponse.json({ message: '처리 중 서버 오류' }, { status: 500 });
  }
}
