import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'kpcqa_secret_key';

// 🚀 우리 부서 신청 내역 조회 (GET)
export async function GET() {
  try {
    // [1] 쿠키에서 토큰 추출 및 인증 확인
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
    }

    // [2] JWT 검증 및 유저/부서 정보 로드
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: true }
    });

    if (!user || !user.unit) {
      return NextResponse.json({ 
        error: '부서 정보가 등록되지 않은 사용자입니다. 관리자에게 문의하세요.' 
      }, { status: 403 });
    }

    // [3] 해당 부서(unit_name) 명의로 신청된 내역만 필터링 조회
    // 💡 팁: 부서명이 정확히 일치하는 신청 건만 가져오며, 품목 정보(item)를 포함합니다.
    const myDeptRequests = await prisma.supplyRequest.findMany({
      where: { 
        dept_name: user.unit.unit_name 
      },
      include: { 
        item: {
          select: {
            name: true,
            image_url: true,
            description: true
          }
        } 
      },
      orderBy: { createdAt: 'desc' } // 최신 신청 순서대로 정렬
    });
    
    return NextResponse.json(myDeptRequests);

  } catch (error: any) {
    console.error("Dept Requests GET Error:", error);
    return NextResponse.json({ error: '데이터를 불러오는 중 서버 오류가 발생했습니다.' }, { status: 500 });
  }
}