import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
export const dynamic = 'force-dynamic';
  
// 🚀 1. 입고 이력 전체 조회 (GET)
export async function GET() {
  try {
    const logs = await prisma.supplyPurchase.findMany({
      include: { item: true },
      orderBy: { purchase_date: 'desc' }
    });
    return NextResponse.json(logs);
  } catch (error: any) {
    return NextResponse.json({ error: '입고 내역을 불러오지 못했습니다.' }, { status: 500 });
  }
}
  
// 🚀 2. 입고 이력 생성 및 재고 합산 (POST)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 1️⃣ 기본 값들부터 안전하게 먼저 파싱 (참조 에러 방지를 위해 계산 변수보다 위로 배치)
    const itemId = String(body.item_id || body.itemId || '');
    const qty = Number(body.qty || body.p_qty || 0);
    const unitPrice = Number(body.unit_price || body.unitPrice || 0);
    const extraCost = Number(body.extra_cost || body.extraCost || 0);   
    
    // 🚀 2️⃣ 결산 총비용 정밀 연산 방어막 
    // 프론트엔드가 총비용을 0으로 주더라도 (단가 * 수량) + 부대비용으로 백엔드에서 강제 자동 계산합니다.
    const totalPrice = Math.floor(
      Number(body.total_price || body.totalPrice) || ((unitPrice * qty) + extraCost)
    );
    
    const purchaserName = String(body.purchaser_name || body.purchaserName || body.admin_name || '관리자');     
    const purchaserDept = String(body.purchaser_dept || body.purchaserDept || body.admin_dept || '운영팀');       
    
    // 거래처 정보 파싱
    const inputVendor = String(body.supplier || body.vendor || '');

    if (!itemId || qty <= 0) {
      return NextResponse.json({ error: '유효한 품목 ID와 수량을 입력해주세요.' }, { status: 400 });
    }
  
    let safeDate = new Date();
    if (body.purchase_date || body.purchaseDate) {
      const parsedDate = new Date(body.purchase_date || body.purchaseDate);
      if (!isNaN(parsedDate.getTime())) safeDate = parsedDate;
    }
   
    const newLog = await prisma.$transaction(async (tx) => {
      
      // 🚀 TypeScript와 Prisma 스키마를 완벽히 만족시키는 데이터 조립
      const purchaseData: any = {
        item_id: itemId,
        qty: Math.floor(qty),             
        total_price: Math.floor(totalPrice), 
        unit_price: Math.floor(unitPrice), 
        purchaser_name: purchaserName,     
        purchaser_dept: purchaserDept,       
        purchase_date: safeDate,
        note: JSON.stringify({ 
          text: body.note || '대시보드 직접 입고', 
          extra_cost: extraCost 
        })
      };
      
      // 💡 핵심 수정: 'vendor'가 아니라 스키마에 존재하는 'old_vendor' 필드 사용
      if (inputVendor) {
        purchaseData.old_vendor = inputVendor; 
      }
   
      // [A] 입고 내역 기록 생성
      const log = await tx.supplyPurchase.create({
        data: purchaseData
      });
    
      // [B] 실제 창고 재고 증가
      await tx.supplyItem.update({
        where: { id: itemId },
        data: { current_stock: { increment: Math.floor(qty) } }
      });
   
      return log;
    });
  
    return NextResponse.json({ success: true, data: newLog });
  } catch (error: any) {
    console.error("❌ 입고 처리 API 에러:", error);
    return NextResponse.json({ error: error.message || '입고 처리 중 데이터베이스 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 🚀 3. 입고 삭제 (철회 시 재고도 같이 복구)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: '삭제할 ID가 없습니다.' }, { status: 400 });

    // 1. 삭제할 입고 데이터 조회 (재고를 얼마나 뺄지 확인하기 위해)
    const log = await prisma.supplyPurchase.findUnique({ where: { id } });
    if (!log) return NextResponse.json({ error: '존재하지 않는 입고 내역입니다.' }, { status: 404 });

    // 2. 트랜잭션으로 삭제 + 재고 차감
    await prisma.$transaction([
      prisma.supplyPurchase.delete({ where: { id } }),
      prisma.supplyItem.update({
        where: { id: log.item_id },
        data: { current_stock: { decrement: log.qty } }
      })
    ]);

    return NextResponse.json({ success: true, message: '입고 내역이 철회되었으며 재고가 조정되었습니다.' });
  } catch (error: any) {
    return NextResponse.json({ error: '입고 철회 실패: ' + error.message }, { status: 500 });
  }
}