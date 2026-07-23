import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSessionUser, authErrorToResponse } from '@/lib/server-auth-guard';

/**
 * 소모품 조회·신청 — 로그인만 있으면 가능 (메뉴 편집 권한 불필요)
 * GET/POST 동일: Active 세션 사용자
 */

/** [GET] 게시된 소모품 카탈로그 */
export async function GET() {
  try {
    await requireSessionUser();

    const items = await prisma.supplyItem.findMany({
      where: { is_active: true, is_published: true },
      select: {
        id: true,
        name: true,
        category: true,
        current_stock: true,
        image_url: true,
        description: true,
        is_active: true,
        is_published: true,
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ items });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/inventory GET]', error);
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

/**
 * [POST] 소모품 신청 (선차감)
 * - 신청자는 세션 유저만 사용 (바디 user_id 무시)
 * - 존재하지 않는 품목 생성 금지
 * - qty > 0, 재고 충분할 때만 차감
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await requireSessionUser();

    const body = await req.json();
    const itemId = String(body.item_id || body.itemId || '').trim();
    const qty = Number(body.qty);
    const note = String(body.note || '').trim();

    if (!itemId) {
      return NextResponse.json({ error: '품목 ID가 필요합니다.' }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      return NextResponse.json({ error: '신청 수량은 1 이상의 정수여야 합니다.' }, { status: 400 });
    }

    const existingItem = await prisma.supplyItem.findUnique({
      where: { id: itemId },
    });
    if (!existingItem || !existingItem.is_active || !existingItem.is_published) {
      return NextResponse.json(
        { error: '신청할 수 없는 품목입니다. (미게시·폐기 또는 존재하지 않음)' },
        { status: 400 }
      );
    }
    if (existingItem.current_stock < qty) {
      return NextResponse.json(
        { error: `재고가 부족합니다. (현재고 ${existingItem.current_stock})` },
        { status: 400 }
      );
    }

    const actualDeptName = sessionUser.unit?.unit_name || '소속 부서 없음';

    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.supplyItem.updateMany({
          where: { id: itemId, current_stock: { gte: qty }, is_active: true, is_published: true },
          data: { current_stock: { decrement: qty } },
        });
        if (updated.count === 0) {
          throw new Error('STOCK_INSUFFICIENT');
        }

        return tx.supplyRequest.create({
          data: {
            item_id: itemId,
            qty,
            user_email: sessionUser.email,
            user_name: sessionUser.name,
            dept_name: actualDeptName,
            status: 'PENDING',
            note,
          },
        });
      });

      return NextResponse.json({ success: true, data: result }, { status: 200 });
    } catch (e: any) {
      if (e?.message === 'STOCK_INSUFFICIENT') {
        return NextResponse.json({ error: '재고가 부족하여 신청할 수 없습니다.' }, { status: 409 });
      }
      if (e?.code === 'P2025') {
        return NextResponse.json({ error: '재고가 부족하여 신청할 수 없습니다.' }, { status: 409 });
      }
      throw e;
    }
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/inventory POST]', error);
    return NextResponse.json(
      { error: error?.message || '서버 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
