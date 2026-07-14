// src/app/api/asset/supplies/inventory/route.ts
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
// [GET] 사용자 앱에서 물품 목록 조회 (초고속 인덱싱 스캔 스타일)
export async function GET() {
  try {
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
        is_published: true
      },
      orderBy: { name: 'asc' } // 애초에 DB에서 가나다순 정렬로 가져와 메모리 연산 절약
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ items: [] });
  }
}
  
// [POST] 사용자가 팝업창에서 '신청 완료'를 눌렀을 때 호출 (🚀 선차감 적용)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const itemId = body.item_id || body.itemId;
    const qty = Number(body.qty) || 1;
    const note = body.note || '';
    const itemName = body.item_name || '소모품';
    const unit = body.unit || 'EA';
    const userId = body.user_id;
  
    if (!userId) {
      return NextResponse.json({ error: "로그인 세션 정보가 누락되었습니다." }, { status: 401 });
    }
  
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { unit: true }
    });
  
    if (!user) {
      return NextResponse.json({ error: "시스템에 등록되지 않은 유효하지 않은 사용자입니다." }, { status: 400 });
    }
  
    const actualDeptName = user.unit?.unit_name || '소속 부서 없음';
  
    const existingItem = await prisma.supplyItem.findUnique({
      where: { id: String(itemId) }
    });
  
    if (!existingItem) {
      await prisma.supplyItem.create({
        data: {
          id: String(itemId), name: String(itemName), category: '소모품',
          owner_dept: actualDeptName, current_stock: 1000, alert_qty: 5,
          description: JSON.stringify({ r_unit: unit, s_unit: 'BOX' }),
          is_active: true, is_published: true
        }
      });
    }
  
    const result = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.supplyItem.update({
        where: { id: String(itemId), current_stock: { gte: qty } },
        data: { current_stock: { decrement: qty } }
      });
     
      if (!updatedItem) throw new Error("재고가 부족하여 신청할 수 없습니다.");
     
      return await tx.supplyRequest.create({
        data: {
          item_id: String(itemId),
          qty: qty,
          user_email: user.email,
          user_name: user.name,
          dept_name: actualDeptName,
          status: 'PENDING',
          note: note
        }
      });
    });
  
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  
  } catch (error: any) {
    console.error("❌ 백엔드 처리 에러:", error);
    return NextResponse.json({ error: error.message || "서버 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}