import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
export const dynamic = 'force-dynamic';
  
// 🚀 1. 입고 이력 전체 조회 (GET) - 405 에러 해결 및 Purchase 화면용
export async function GET() {
  try {
    const logs = await prisma.supplyPurchase.findMany({
      include: { 
        item: true // 연관된 품목 정보(이름 등)를 함께 가져옴
      },
      orderBy: { 
        purchase_date: 'desc' // 최신 입고순 정렬
      }
    });
    return NextResponse.json(logs);
  } catch (error: any) {
    console.error("입고 조회 API 에러:", error);
    return NextResponse.json({ error: '입고 내역을 불러오지 못했습니다.' }, { status: 500 });
  }
}
  
// 🚀 2. 입고 이력 생성 및 재고 합산 (POST)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 프론트엔드에서 넘겨받은 데이터 정리
    const p_qty = Number(body.p_qty) || 1;
    const sub_qty = Number(body.sub_qty) || 1;
    const total_amount = Number(body.unit_price); // 입력값(총액)
    
    // 재고 합산 및 단가 계산
    const total_inbound_stock = p_qty * sub_qty; 
    const calculated_unit_price = Math.floor(total_amount / (total_inbound_stock || 1));
  
    // 1️⃣ 입고 이력 생성 (SupplyPurchase)
    const newLog = await prisma.supplyPurchase.create({
      data: {
        item_id: body.item_id,
        qty: p_qty,             
        total_price: total_amount, 
        unit_price: calculated_unit_price, 
  
        // 🚀 하드코딩 제거: UI에서 보낸 로그인 사용자 정보(admin_name, admin_dept)를 직접 저장
        purchaser_name: body.admin_name || '관리자',     
        purchaser_dept: body.admin_dept || '운영팀',       
        
        purchase_date: new Date(body.purchase_date),
        vendor: body.vendor,
        // 나중에 대시보드에서 꺼내보기 쉽도록 구성 정보(p_qty, sub_qty)를 JSON으로 변환하여 저장
        note: JSON.stringify({ text: body.note || '', p_qty, sub_qty }) 
      }
    });
  
    // 2️⃣ 실제 재고 업데이트 (SupplyItem 테이블의 current_stock 합산)
    await prisma.supplyItem.update({
      where: { id: body.item_id },
      data: {
        current_stock: { increment: total_inbound_stock }
      }
    });
  
    return NextResponse.json({ success: true, data: newLog });
  } catch (error: any) {
    console.error("입고 처리 API 에러:", error);
    return NextResponse.json({ error: error.message || '입고 처리 중 오류 발생' }, { status: 500 });
  }
}

// 🚀 3. [신규 추가] 입고 이력 삭제 (DELETE)
export async function DELETE(req: Request) {
  try {
    // 1. 주소창 파라미터(?id=...)에서 추출 시도
    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');

    // 2. 파라미터에 없으면 바디({id})에서 추출 시도
    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {
        // 무시
      }
    }

    if (!id) {
      return NextResponse.json({ error: '삭제할 입고 내역의 ID가 전달되지 않았습니다.' }, { status: 400 });
    }

    // 💡 정책: 삭제 시 '현재 재고'는 자동으로 차감하지 않고, 오직 '입고 이력 기록'만 삭제합니다.
    await prisma.supplyPurchase.delete({
      where: { id }
    });

    return NextResponse.json({ success: true, message: '입고 내역이 삭제되었습니다.' });
  } catch (error: any) {
    console.error("입고 내역 DELETE 에러:", error);
    return NextResponse.json({ error: '삭제 처리 중 서버 오류 발생' }, { status: 500 });
  }
}