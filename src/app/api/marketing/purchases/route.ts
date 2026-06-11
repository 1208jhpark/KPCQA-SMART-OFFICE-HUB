import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const purchases = await prisma.marketingPurchase.findMany({
      include: { item: true },
      // 🚀 purchase_date가 같을 경우를 대비해 createdAt(실제 등록시간) 기준으로 최신순 정렬
      orderBy: [
        { purchase_date: 'desc' },
        { createdAt: 'desc' }
      ]
    });
    return NextResponse.json(purchases);
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const qty = Number(body.qty) || 0;
    const unitPrice = Number(body.unit_price) || 0;

    const [newPurchase] = await prisma.$transaction([
      prisma.marketingPurchase.create({
        data: {
          item_id: body.item_id,
          qty: qty,
          unit_price: unitPrice,
          total_price: qty * unitPrice,
          vendor: body.vendor || '',
          note: body.note || '',
          purchaser_name: body.purchaser_name || '관리자',
          purchaser_dept: body.purchaser_dept || '미소속',
          purchase_date: body.purchase_date ? new Date(body.purchase_date) : new Date(),
        }
      }),
      prisma.marketingItem.update({
        where: { id: body.item_id },
        data: { 
          current_stock: { increment: qty },
          unit_price: unitPrice 
        }
      })
    ]);

    return NextResponse.json(newPurchase);
  } catch (error: any) {
    console.error("🔥 [입고 처리 에러]:", error.message);
    return NextResponse.json({ error: '입고 등록 실패', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const purchase = await prisma.marketingPurchase.findUnique({ where: { id } });
    if (!purchase) return NextResponse.json({ error: '기록을 찾을 수 없습니다.' }, { status: 404 });

    await prisma.$transaction([
      prisma.marketingPurchase.delete({ where: { id } }),
      prisma.marketingItem.update({
        where: { id: purchase.item_id },
        data: { current_stock: { decrement: purchase.qty } }
      })
    ]);

    return NextResponse.json({ message: '입고 취소 완료' });
  } catch (error: any) {
    console.error("🔥 [입고 취소 에러]:", error.message);
    return NextResponse.json({ error: '입고 취소 실패' }, { status: 500 });
  }
}