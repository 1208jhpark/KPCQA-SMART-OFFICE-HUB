import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseKSTDateOnly } from '@/utils/dateUtils';
import {
  authorizeMarketingPurchasesRead,
  authorizeMarketingPurchasesWrite,
  assertCanEditOwnerDept,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

function parsePurchaseNote(note: unknown): { text: string; extra_cost: number } {
  if (!note || typeof note !== 'string') return { text: '', extra_cost: 0 };
  try {
    const parsed = JSON.parse(note);
    if (parsed && typeof parsed === 'object') {
      return {
        text: String((parsed as { text?: unknown }).text || ''),
        extra_cost: Number((parsed as { extra_cost?: unknown }).extra_cost) || 0,
      };
    }
  } catch {
    /* legacy plain-text note */
  }
  return { text: note, extra_cost: 0 };
}

function shapePurchase<T extends { old_vendor?: string | null; note?: string | null }>(purchase: T) {
  const parsedNote = parsePurchaseNote(purchase.note);
  return {
    ...purchase,
    vendor: purchase.old_vendor ?? '',
    note: parsedNote.text,
    extra_cost: parsedNote.extra_cost,
  };
}

function parsePurchaseDate(raw: unknown) {
  if (!raw || typeof raw !== 'string') return new Date();
  const d = parseKSTDateOnly(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export async function GET() {
  try {
    await authorizeMarketingPurchasesRead();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const purchases = await prisma.marketingPurchase.findMany({
      include: { item: true },
      orderBy: [{ purchase_date: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(purchases.map(shapePurchase));
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingPurchasesWrite();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const itemId = body.item_id;
    const qty = Math.floor(Number(body.qty) || 0);
    const unitPrice = Math.floor(Number(body.unit_price) || 0);
    const extraCost = Math.floor(Number(body.extra_cost ?? body.extraCost ?? 0));
    const vendorText = body.vendor ?? body.old_vendor ?? '';

    if (!itemId) return NextResponse.json({ error: '물품 ID가 필요합니다.' }, { status: 400 });
    if (qty <= 0) return NextResponse.json({ error: '입고 수량은 1 이상이어야 합니다.' }, { status: 400 });
    if (unitPrice < 0 || extraCost < 0) {
      return NextResponse.json({ error: '단가/부대비용은 0 이상이어야 합니다.' }, { status: 400 });
    }

    const newPurchase = await prisma.$transaction(async (tx) => {
      const item = await tx.marketingItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error('ITEM_NOT_FOUND');
      if (item.is_archived) throw new Error('ITEM_ARCHIVED');

      assertCanEditOwnerDept(auth, item.owner_dept);

      // 카탈로그 단가와 동일할 때만 입고 — 단가 변경은 신규 물품 등록
      if (unitPrice !== Number(item.unit_price || 0)) {
        throw new Error('PRICE_MISMATCH');
      }

      const totalPrice = Math.floor(
        Number(body.total_price ?? body.totalPrice) || unitPrice * qty + extraCost
      );

      await tx.marketingItem.update({
        where: { id: itemId },
        data: {
          current_stock: { increment: qty },
        },
      });

      return tx.marketingPurchase.create({
        data: {
          item_id: itemId,
          qty,
          unit_price: unitPrice,
          total_price: totalPrice,
          old_vendor: vendorText,
          note: JSON.stringify({
            text: body.note || '',
            extra_cost: extraCost,
          }),
          // 신원은 서버 세션 기준으로 고정 (동명이인·spoof 방지)
          purchaser_name: auth.user.name || '관리자',
          purchaser_dept: auth.user.unit?.unit_name || '미소속',
          purchaser_email: auth.user.email || null,
          purchase_date: parsePurchaseDate(body.purchase_date),
        },
      });
    });

    return NextResponse.json(shapePurchase(newPurchase));
  } catch (error: any) {
    if (error?.message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (error?.message === 'ITEM_ARCHIVED') {
      return NextResponse.json({ error: '종료된 물품에는 입고할 수 없습니다.' }, { status: 400 });
    }
    if (error?.message === 'PRICE_MISMATCH') {
      return NextResponse.json(
        {
          error:
            '입고 단가는 등록된 물품 단가와 같아야 합니다. 단가가 변경된 경우 신규 기념품으로 등록해 주세요.',
        },
        { status: 400 }
      );
    }
    if (error?.message === 'FORBIDDEN_EDIT') {
      return authErrorToResponse(error);
    }
    console.error('🔥 [입고 처리 에러]:', error.message);
    return NextResponse.json({ error: '입고 등록 실패', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingPurchasesWrite();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      const purchase = await tx.marketingPurchase.findUnique({
        where: { id },
        include: { item: true },
      });
      if (!purchase) throw new Error('PURCHASE_NOT_FOUND');

      assertCanEditOwnerDept(auth, purchase.item?.owner_dept);

      const stockResult = await tx.marketingItem.updateMany({
        where: {
          id: purchase.item_id,
          current_stock: { gte: purchase.qty },
        },
        data: {
          current_stock: { decrement: purchase.qty },
        },
      });

      if (stockResult.count === 0) {
        const item = await tx.marketingItem.findUnique({ where: { id: purchase.item_id } });
        if (!item) throw new Error('ITEM_NOT_FOUND');
        throw new Error('INSUFFICIENT_STOCK_FOR_CANCEL');
      }

      await tx.marketingPurchase.delete({ where: { id } });
    });

    return NextResponse.json({ message: '입고 취소 완료' });
  } catch (error: any) {
    if (error?.message === 'PURCHASE_NOT_FOUND') {
      return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (error?.message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (error?.message === 'INSUFFICIENT_STOCK_FOR_CANCEL') {
      return NextResponse.json(
        { error: '현재 재고가 부족하여 입고를 취소할 수 없습니다. (이미 지급된 수량일 수 있습니다.)' },
        { status: 409 }
      );
    }
    if (error?.message === 'FORBIDDEN_EDIT') {
      return authErrorToResponse(error);
    }
    console.error('🔥 [입고 취소 에러]:', error.message);
    return NextResponse.json({ error: '입고 취소 실패' }, { status: 500 });
  }
}
