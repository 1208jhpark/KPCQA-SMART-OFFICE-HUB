import prisma from '@/lib/prisma';
import { assertSupplyOwnerDeptsEditable } from '@/lib/server-auth-guard';
import { parseKSTDateOnly } from '@/utils/dateUtils';
import { parseSupplyOwnerDepts } from '@/utils/orgUnits';

function sessionDeptName(user: any) {
  return user?.unit?.unit_name || '소속 부서 없음';
}

/** 입고 등록 + 재고 increment (대시보드·입고대장 공통) — owner_dept 편집 스코프 필수 */
export async function createSupplyStockIn(auth: any, body: any) {
  const authUser = auth?.user ?? auth;
  const itemId = String(body.item_id || body.itemId || '').trim();
  const pQty = Math.floor(Number(body.p_qty || body.pQty || 0));
  const linkQty = Math.floor(Number(body.link_qty || body.linkQty || 0));
  let stockQty = Math.floor(Number(body.qty || 0));
  if ((!Number.isFinite(stockQty) || stockQty <= 0) && pQty > 0 && linkQty > 0) {
    stockQty = pQty * linkQty;
  }
  const unitPrice = Math.floor(Number(body.unit_price || body.unitPrice || 0));
  const extraCost = Math.floor(Number(body.extra_cost || body.extraCost || 0));
  const pUnit = String(body.p_unit || body.pUnit || '').trim();
  const sUnit = String(body.s_unit || body.sUnit || '').trim();

  if (!itemId) {
    return { ok: false as const, status: 400, error: '품목 ID가 필요합니다.' };
  }
  if (!Number.isFinite(stockQty) || stockQty <= 0) {
    return { ok: false as const, status: 400, error: '재고 반영 수량은 1 이상이어야 합니다.' };
  }
  if (pQty > 0 && linkQty <= 0) {
    return { ok: false as const, status: 400, error: '입고단위 연동 수량은 1 이상이어야 합니다.' };
  }
  if (unitPrice < 0 || extraCost < 0) {
    return { ok: false as const, status: 400, error: '단가/부대비용은 0 이상이어야 합니다.' };
  }

  const item = await prisma.supplyItem.findUnique({ where: { id: itemId } });
  if (!item || !item.is_active) {
    return { ok: false as const, status: 400, error: '입고할 수 없는 품목입니다.' };
  }

  // authorizeApi 결과(auth)가 오면 owner_dept 편집 스코프 강제
  if (auth?.permission) {
    try {
      assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(item.owner_dept));
    } catch (e: any) {
      if (e?.message === 'FORBIDDEN_EDIT') {
        return { ok: false as const, status: 403, error: '해당 품목의 물품소속에 대한 입고 권한이 없습니다.' };
      }
      throw e;
    }
  }

  const purchasePacks = pQty > 0 ? pQty : stockQty;
  const totalPrice = Math.floor(
    Number(body.total_price || body.totalPrice) || unitPrice * purchasePacks + extraCost
  );

  const inputVendor = String(body.supplier || body.vendor || '').trim();

  let safeDate = new Date();
  const dateRaw = String(body.purchase_date || body.purchaseDate || '').trim();
  if (dateRaw) {
    const parsedDate = parseKSTDateOnly(dateRaw);
    if (!Number.isNaN(parsedDate.getTime())) safeDate = parsedDate;
  }

  let itemSUnit = sUnit;
  if (!itemSUnit) {
    try {
      const ext = JSON.parse(item.description || '{}');
      itemSUnit = ext.s_unit || ext.r_unit || '';
    } catch {
      /* ignore */
    }
  }

  const boughtDateRaw = String(body.bought_date || body.boughtDate || '').trim();
  const boughtYmd = boughtDateRaw && !Number.isNaN(parseKSTDateOnly(boughtDateRaw).getTime())
    ? boughtDateRaw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || boughtDateRaw
    : boughtDateRaw || null;

  const newLog = await prisma.$transaction(async (tx) => {
    const purchaseData: any = {
      item_id: itemId,
      qty: stockQty,
      total_price: totalPrice,
      unit_price: unitPrice,
      purchaser_name: authUser?.name || '관리자',
      purchaser_dept: sessionDeptName(authUser),
      purchase_date: safeDate,
      note: JSON.stringify({
        text: body.note || '대시보드 직접 입고',
        extra_cost: extraCost,
        bought_date: boughtYmd,
        p_qty: purchasePacks,
        p_unit: pUnit || null,
        link_qty: linkQty > 0 ? linkQty : purchasePacks > 0 ? Math.floor(stockQty / purchasePacks) : 1,
        s_unit: itemSUnit || null,
        stock_qty: stockQty,
      }),
    };

    if (inputVendor) {
      purchaseData.old_vendor = inputVendor;
    }

    const log = await tx.supplyPurchase.create({ data: purchaseData });

    await tx.supplyItem.update({
      where: { id: itemId },
      data: { current_stock: { increment: stockQty } },
    });

    return log;
  });

  return { ok: true as const, data: newLog };
}
