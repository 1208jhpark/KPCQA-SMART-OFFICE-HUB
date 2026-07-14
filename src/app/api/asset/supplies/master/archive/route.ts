import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
export const dynamic = 'force-dynamic';
  
// 🚀 1. 폐기된(is_active: false) 물품만 골라서 가져오기 (GET)
export async function GET() {
  try {
    const archivedItems = await prisma.supplyItem.findMany({
      where: { is_active: false },
      orderBy: { updatedAt: 'desc' } // 최근 수정/폐기된 순
    });
    return NextResponse.json(archivedItems);
  } catch (error) {
    console.error('Archive GET Error:', error);
    return NextResponse.json({ error: '아카이브 로드 실패' }, { status: 500 });
  }
}

// 🚀 2. [수정됨] 아카이브 자산 및 연관 기록 영구 삭제 (트랜잭션 처리)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');
    
    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {}
    }
  
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    // ✅ 트랜잭션 사용: 연관된 모든 기록(입고, 신청)을 먼저 지우고 품목을 삭제
    await prisma.$transaction([
      prisma.supplyPurchase.deleteMany({ where: { item_id: id } }),
      prisma.supplyRequest.deleteMany({ where: { item_id: id } }),
      prisma.supplyItem.delete({ where: { id } })
    ]);
  
    return NextResponse.json({ success: true, message: '영구 삭제 완료' });
  } catch (error) {
    console.error('Archive DELETE Error:', error);
    return NextResponse.json({ error: '삭제 처리 실패' }, { status: 500 });
  }
}