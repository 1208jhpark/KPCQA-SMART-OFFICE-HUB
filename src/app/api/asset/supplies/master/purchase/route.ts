import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, assertSupplyOwnerDeptsEditable, authErrorToResponse } from '@/lib/server-auth-guard';
import { createSupplyStockIn } from '@/lib/supply-stock-in';
import { parseSupplyOwnerDepts } from '@/utils/orgUnits';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/purchase';

/** [GET] 입고 이력 — item.image_url 제외(목록 페이로드) */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const logs = await prisma.supplyPurchase.findMany({
      include: {
        item: {
          select: {
            id: true,
            name: true,
            description: true,
            current_stock: true,
          },
        },
      },
      orderBy: { purchase_date: 'desc' },
    });
    return NextResponse.json(logs);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/purchase GET]', error);
    return NextResponse.json({ error: '입고 내역을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** [POST] 입고 — 등록자는 세션 유저 고정 · owner_dept 편집 스코프 · 일자는 KST */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();

    const result = await createSupplyStockIn(auth, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/purchase POST]', error);
    return NextResponse.json(
      { error: error?.message || '입고 처리 중 데이터베이스 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/** [DELETE] 입고 철회 — 재고 차감 · 해당 품목 owner_dept 편집 스코프 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });

    const log = await prisma.supplyPurchase.findUnique({
      where: { id },
      include: { item: { select: { id: true, owner_dept: true } } },
    });
    if (!log) return NextResponse.json({ error: '존재하지 않는 입고 내역입니다.' }, { status: 404 });

    assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(log.item?.owner_dept));

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.supplyItem.updateMany({
          where: { id: log.item_id, current_stock: { gte: log.qty } },
          data: { current_stock: { decrement: log.qty } },
        });
        if (updated.count === 0) {
          throw new Error('STOCK_INSUFFICIENT');
        }
        await tx.supplyPurchase.delete({ where: { id } });
      });
    } catch (e: any) {
      if (e?.message === 'STOCK_INSUFFICIENT') {
        return NextResponse.json(
          { error: '현재고가 부족하여 입고를 철회할 수 없습니다.' },
          { status: 409 }
        );
      }
      throw e;
    }

    return NextResponse.json({
      success: true,
      message: '입고 내역이 철회되었으며 재고가 조정되었습니다.',
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/purchase DELETE]', error);
    return NextResponse.json({ error: '입고 철회 실패: ' + (error?.message || '') }, { status: 500 });
  }
}
