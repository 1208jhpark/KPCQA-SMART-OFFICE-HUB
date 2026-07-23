import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/purchase';

function sessionDeptName(user: any) {
  return user?.unit?.unit_name || '소속 부서 없음';
}

/** [GET] 입고 이력 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const logs = await prisma.supplyPurchase.findMany({
      include: { item: true },
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

/** [POST] 입고 — 등록자는 세션 유저 고정 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();

    const itemId = String(body.item_id || body.itemId || '').trim();
    const qty = Math.floor(Number(body.qty || body.p_qty || 0));
    const unitPrice = Math.floor(Number(body.unit_price || body.unitPrice || 0));
    const extraCost = Math.floor(Number(body.extra_cost || body.extraCost || 0));

    if (!itemId) {
      return NextResponse.json({ error: '품목 ID가 필요합니다.' }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: '입고 수량은 1 이상의 정수여야 합니다.' }, { status: 400 });
    }
    if (unitPrice < 0 || extraCost < 0) {
      return NextResponse.json({ error: '단가/부대비용은 0 이상이어야 합니다.' }, { status: 400 });
    }

    const item = await prisma.supplyItem.findUnique({ where: { id: itemId } });
    if (!item || !item.is_active) {
      return NextResponse.json({ error: '입고할 수 없는 품목입니다.' }, { status: 400 });
    }

    const totalPrice = Math.floor(
      Number(body.total_price || body.totalPrice) || unitPrice * qty + extraCost
    );

    const inputVendor = String(body.supplier || body.vendor || '').trim();

    let safeDate = new Date();
    if (body.purchase_date || body.purchaseDate) {
      const parsedDate = new Date(body.purchase_date || body.purchaseDate);
      if (!isNaN(parsedDate.getTime())) safeDate = parsedDate;
    }

    const newLog = await prisma.$transaction(async (tx) => {
      const purchaseData: any = {
        item_id: itemId,
        qty,
        total_price: totalPrice,
        unit_price: unitPrice,
        purchaser_name: auth.user.name || '관리자',
        purchaser_dept: sessionDeptName(auth.user),
        purchase_date: safeDate,
        note: JSON.stringify({
          text: body.note || '대시보드 직접 입고',
          extra_cost: extraCost,
        }),
      };

      if (inputVendor) {
        purchaseData.old_vendor = inputVendor;
      }

      const log = await tx.supplyPurchase.create({ data: purchaseData });

      await tx.supplyItem.update({
        where: { id: itemId },
        data: { current_stock: { increment: qty } },
      });

      return log;
    });

    return NextResponse.json({ success: true, data: newLog });
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

/** [DELETE] 입고 철회 — 재고 차감 (부족하면 거부) */
export async function DELETE(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });

    const log = await prisma.supplyPurchase.findUnique({ where: { id } });
    if (!log) return NextResponse.json({ error: '존재하지 않는 입고 내역입니다.' }, { status: 404 });

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
