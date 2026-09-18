import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeAnyMenuPaths,
  assertSupplyOwnerDeptsEditable,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { createSupplyStockIn } from '@/lib/supply-stock-in';
import { parseSupplyOwnerDepts } from '@/utils/orgUnits';

export const dynamic = 'force-dynamic';

/** 신 경로 + 구 purchase 메뉴(마이그레이션 전) 모두 허용 */
const MENU_PATHS = [
  '/asset/supplies/master/restock',
  '/asset/supplies/master/purchase',
];

/** [GET] 입고 이력 — item.image_url 제외(목록 페이로드) */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(MENU_PATHS);

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
    console.error('[supplies/master/restock GET]', error);
    return NextResponse.json({ error: '입고 내역을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/** [POST] 입고 — 등록자는 세션 유저 고정 · owner_dept 편집 스코프 · 일자는 KST */
export async function POST(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(MENU_PATHS, { requireEditor: true });
    const body = await req.json();

    const result = await createSupplyStockIn(auth, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/restock POST]', error);
    return NextResponse.json(
      { error: error?.message || '입고 처리 중 데이터베이스 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/** [DELETE] 입고 철회(Edit) 또는 영구삭제(mode=purge · LV_1만) — 재고 차감 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeAnyMenuPaths(MENU_PATHS, { requireEditor: true });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const mode = String(searchParams.get('mode') || '').trim().toLowerCase();

    if (!id) return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });

    if (mode === 'purge') {
      if (auth.permission.myRole !== 'LV_1') {
        return NextResponse.json(
          { error: '잘못된 데이터 영구삭제는 LV_1만 가능합니다.' },
          { status: 403 }
        );
      }
    }

    const log = await prisma.supplyPurchase.findUnique({
      where: { id },
      include: { item: { select: { id: true, owner_dept: true, owner_unit_ids: true } } },
    });
    if (!log) return NextResponse.json({ error: '존재하지 않는 입고 내역입니다.' }, { status: 404 });

    assertSupplyOwnerDeptsEditable(
      auth,
      parseSupplyOwnerDepts(log.item?.owner_dept),
      (log.item as { owner_unit_ids?: unknown } | null | undefined)?.owner_unit_ids
    );

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
      message: mode === 'purge' ? '입고 내역이 영구 삭제되었습니다.' : '입고가 철회되었습니다.',
    });
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/restock DELETE]', error);
    return NextResponse.json(
      { error: error?.message || '삭제 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
