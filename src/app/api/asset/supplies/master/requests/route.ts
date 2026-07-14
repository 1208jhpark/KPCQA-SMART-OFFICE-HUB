import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 1. 전체 신청 내역 조회
export async function GET(req: Request) {
  try {
    const requests = await prisma.supplyRequest.findMany({
      include: { item: true }, // 🚀 존재하지 않는 user relation을 제거하고 item만 가져옵니다.
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(requests);
  } catch (error) {
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

// 2. 🚀 상태 변경 및 관리자 코멘트 업데이트 (데이터 증발 방어 완비)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, status, admin_opinion, admin_name, admin_dept, is_rejected_restore, item_id, qty } = body;

    await prisma.$transaction(async (tx) => {
      // ✅ 기존 데이터를 날리지 않고, 전달받은 특정 필드만 부분 업데이트
      await tx.supplyRequest.update({
        where: { id },
        data: {
          status: status,
          admin_opinion: admin_opinion, // 기존 코멘트 덮어쓰기 방지
          admin_name: admin_name,
          admin_dept: admin_dept,
          updatedAt: new Date()
        }
      });

      // ✅ 반려(REJECTED) 혹은 철회 시: 물품 재고를 다시 창고로 복구 (increment)
      if (is_rejected_restore && item_id && qty) {
        await tx.supplyItem.update({
          where: { id: item_id },
          data: { current_stock: { increment: Number(qty) } }
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Requests PATCH Error:", error);
    return NextResponse.json({ error: '상태 업데이트 중 서버 오류 발생' }, { status: 500 });
  }
}

// 3. 영구 삭제
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    await prisma.supplyRequest.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}