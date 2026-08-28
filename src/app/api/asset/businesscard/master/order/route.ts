import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTDateString } from '@/utils/dateUtils';
import { authorizeApi, authorizeAnyMenuPaths, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/businesscard/master/order';
const READ_PATHS = [
  '/asset/businesscard/master/order',
  '/asset/businesscard/master/archive',
  '/asset/businesscard/master/requests',
];

/** 발주 완료된 묶음(Batch) 대장 목록 */
export async function GET(req: Request) {
  try {
    await authorizeAnyMenuPaths(READ_PATHS);
    const { searchParams } = new URL(req.url);
    const isArchivedParam = searchParams.get('isArchived');

    const whereCondition =
      isArchivedParam === 'true' ? { isArchived: true } : { isArchived: false };

    const batches = await prisma.businessCardOrderBatch.findMany({
      where: whereCondition,
      include: { items: true },
      orderBy: { id: 'desc' },
    });

    const merged = batches.map((b) => ({
      ...b,
      inspectStatus: b.inspectStatus || 'idle',
      items: (b.items || []).map((item) => ({
        ...item,
        applicantType: item.applicantType || '본인',
        applicantName: item.applicantName || null,
      })),
    }));

    return NextResponse.json(merged, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Batch GET Error:', error);
    return NextResponse.json({ message: '묶음 대장 로드 실패', error: error.message }, { status: 500 });
  }
}

/** 신규 묶음(Batch) 발주 생성 */
export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();

    const batchId = body.batchId || body.id;
    const targetRequestIds = body.targetRequestIds || body.itemIds;
    const { deptHeadGroup } = body;

    if (!targetRequestIds || targetRequestIds.length === 0) {
      return NextResponse.json({ message: '발주할 명함이 선택되지 않았습니다.' }, { status: 400 });
    }

    const isExist = await prisma.businessCardOrderBatch.findUnique({
      where: { id: batchId },
    });
    if (isExist) {
      return NextResponse.json({ message: '이미 존재하는 발주 번호입니다. 잠시 후 다시 시도하세요.' }, { status: 400 });
    }

    const todayStr = getKSTDateString();

    const result = await prisma.$transaction(async (tx) => {
      const newBatch = await tx.businessCardOrderBatch.create({
        data: {
          id: batchId,
          orderDate: todayStr,
          totalCount: targetRequestIds.length,
          deptHeadGroup: deptHeadGroup || '전사종합',
          status: '발주완료',
          isArchived: false,
        },
      });

      await tx.businessCardRequest.updateMany({
        where: { id: { in: targetRequestIds } },
        data: {
          adminStatus: '발주완료',
          orderGroupId: batchId,
        },
      });

      return newBatch;
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Batch POST Error:', error);
    return NextResponse.json({ message: '묶음 발주 생성 실패', error: error.message }, { status: 500 });
  }
}

/** 보관함 이관 */
export async function PUT(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const { batchIds } = body;

    if (!batchIds || batchIds.length === 0) {
      return NextResponse.json({ message: '이관할 묶음 ID가 없습니다.' }, { status: 400 });
    }

    const unpaid = await prisma.businessCardOrderBatch.findMany({
      where: { id: { in: batchIds }, NOT: { status: '지급완료' } },
      select: { id: true },
    });
    if (unpaid.length > 0) {
      return NextResponse.json(
        { message: '지급완료 처리된 묶음만 보관함으로 이관할 수 있습니다.' },
        { status: 400 }
      );
    }

    const inspectRows = await prisma.businessCardOrderBatch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, inspectStatus: true },
    });
    const notMatched = inspectRows.filter((row) => row.inspectStatus !== 'match');
    if (notMatched.length > 0) {
      return NextResponse.json(
        { message: '명세서 검수가 일치한 묶음만 보관함으로 이관할 수 있습니다.' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.businessCardOrderBatch.updateMany({
        where: { id: { in: batchIds }, status: '지급완료' },
        data: { isArchived: true },
      });

      await tx.businessCardRequest.updateMany({
        where: { orderGroupId: { in: batchIds } },
        data: { isArchived: true },
      });

      return { success: true, count: batchIds.length };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Batch PUT Error:', error);
    return NextResponse.json({ message: '보관함 이관 처리 실패', error: error.message }, { status: 500 });
  }
}

/** 지급 완료 */
export async function PATCH(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { batchId } = await req.json();

    if (!batchId) {
      return NextResponse.json({ message: '묶음 ID가 없습니다.' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.businessCardOrderBatch.update({
        where: { id: batchId },
        data: { status: '지급완료' },
      });

      await tx.businessCardRequest.updateMany({
        where: { orderGroupId: batchId },
        data: { adminStatus: '지급완료' },
      });

      return { success: true };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Batch PATCH Error:', error);
    return NextResponse.json({ message: '지급 완료 처리 실패', error: error.message }, { status: 500 });
  }
}

/** 발주 묶음 취소 → 접수완료 대기열 복귀 */
export async function DELETE(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get('batchId');
    if (!batchId) {
      return NextResponse.json({ message: '묶음 ID가 없습니다.' }, { status: 400 });
    }

    const batch = await prisma.businessCardOrderBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      return NextResponse.json({ message: '묶음을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (batch.isArchived) {
      return NextResponse.json({ message: '보관된 묶음은 발주 취소할 수 없습니다.' }, { status: 400 });
    }
    if (batch.status === '지급완료') {
      return NextResponse.json({ message: '지급 처리된 묶음은 발주 취소할 수 없습니다.' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.businessCardRequest.updateMany({
        where: { orderGroupId: batchId },
        data: {
          adminStatus: '접수완료',
          orderGroupId: null,
        },
      });
      await tx.businessCardOrderBatch.delete({ where: { id: batchId } });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[businesscard/master/order DELETE]', error);
    return NextResponse.json({ message: '발주 취소 실패', error: error.message }, { status: 500 });
  }
}
