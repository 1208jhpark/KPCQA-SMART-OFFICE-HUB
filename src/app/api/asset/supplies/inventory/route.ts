import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { canRequestSupplyOwnerDepts, resolveTopOrgName } from '@/utils/orgUnits';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/inventory';

/**
 * 소모품 조회·신청
 * - GET: admin/interface Access(메뉴 접근)
 * - POST(신청·선차감): Access + Edit — interface Edit 설정이 신청 가능 여부를 제어
 * - 목록/신청: owner_dept(단일·다중 JSON) 조직 스코프
 */

function isPowerUser(user: any) {
  const roles = Array.isArray(user?.roles) ? user.roles : [user?.role];
  return roles?.includes('LV_1');
}

function supplyRequestScopeOpts(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  return {
    myUnitName: auth.user?.unit?.unit_name || null,
    myUnitId: auth.user?.unit_id || auth.user?.unit?.id || null,
    myHqName: (auth.user?.unit as any)?.parent?.unit_name || null,
    topOrgName: resolveTopOrgName(auth.unitsList),
    units: auth.unitsList,
    // LV_1 전역 + 이 메뉴 Master = 해당 Step3 카드에서 LV_1과 동일
    isPower: isPowerUser(auth.user) || !!auth.permission?.isMaster,
  };
}

/** [GET] 게시된 소모품 카탈로그 — 로그인 조직 스코프 (LV_1·메뉴 Master는 전체) */
export async function GET() {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const scope = supplyRequestScopeOpts(auth);

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
        owner_dept: true,
      },
      orderBy: { name: 'asc' },
    });

    const visible = scope.isPower
      ? items
      : items.filter((item) => canRequestSupplyOwnerDepts(item.owner_dept, scope));
    return NextResponse.json({ items: visible });
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
 * - owner_dept 스코프 밖 품목 신청 거부
 */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const sessionUser = auth.user;
    const scope = supplyRequestScopeOpts(auth);

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
    if (!canRequestSupplyOwnerDepts(existingItem.owner_dept, scope)) {
      return NextResponse.json(
        { error: '해당 품목은 소속 조직에서 신청할 수 없습니다.' },
        { status: 403 }
      );
    }
    if (existingItem.current_stock < qty) {
      return NextResponse.json(
        { error: `재고가 부족합니다. (현재고 ${existingItem.current_stock})` },
        { status: 400 }
      );
    }

    const actualDeptName = sessionUser.unit?.unit_name || '소속 부서 없음';
    const unitId = sessionUser.unit_id || sessionUser.unit?.id || null;

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
            unit_id: unitId,
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
