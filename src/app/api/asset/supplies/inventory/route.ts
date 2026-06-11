import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

// 🚀 1. 사용자용 물품 목록 조회 (GET)
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    let user = null;

    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        user = await prisma.user.findUnique({
          where: { email: decoded.email },
          include: { unit: true }
        });
      } catch (e) {
        console.error("User Auth Error in Inventory GET");
      }
    }

    // 💡 일반 사용자는 '게시됨' + '활성상태'인 품목만 조회 가능
    const items = await prisma.supplyItem.findMany({
      where: { 
        is_published: true, 
        is_active: true 
      },
      orderBy: { createdAt: 'desc' } // 최신 등록 순
    });
    
    return NextResponse.json({ items, user });
  } catch (error) {
    console.error("Inventory GET Error:", error);
    return NextResponse.json({ error: '데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}

// 🚀 2. 물품 신청 처리 (POST)
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ 
      where: { email: decoded.email },
      include: { unit: true }
    });

    const { item_id, qty, note } = await req.json();
    const requestQty = Number(qty);

    // [검증 1] 신청 수량 확인
    if (!requestQty || requestQty <= 0) {
      return NextResponse.json({ error: '올바른 수량을 입력해주세요.' }, { status: 400 });
    }

    // [검증 2] 실시간 재고 확인 (트랜잭션 전 사전 체크)
    const targetItem = await prisma.supplyItem.findUnique({
      where: { id: item_id }
    });

    if (!targetItem || !targetItem.is_active) {
      return NextResponse.json({ error: '존재하지 않거나 삭제된 품목입니다.' }, { status: 404 });
    }

    if (targetItem.current_stock < requestQty) {
      return NextResponse.json({ 
        error: `재고가 부족합니다. (현재 재고: ${targetItem.current_stock})` 
      }, { status: 400 });
    }

    // 🚀 [핵심] 신청서 생성과 재고 차감을 하나의 트랜잭션으로 묶음
    const [newRequest, updatedItem] = await prisma.$transaction([
      // 1. 신청 이력 생성
      prisma.supplyRequest.create({
        data: {
          item_id,
          qty: requestQty,
          user_email: user?.email || 'unknown',
          user_name: user?.name || '미확인',
          dept_name: user?.unit?.unit_name || '소속없음',
          status: 'PENDING',
          note: note || ''
        }
      }),
      // 2. 품목 재고 차감
      prisma.supplyItem.update({
        where: { id: item_id },
        data: {
          current_stock: { decrement: requestQty }
        }
      })
    ]);

    return NextResponse.json({ success: true, data: newRequest });
  } catch (error: any) {
    console.error("Inventory Request POST Error:", error);
    return NextResponse.json({ error: '신청 처리 중 서버 오류가 발생했습니다.' }, { status: 500 });
  }
}