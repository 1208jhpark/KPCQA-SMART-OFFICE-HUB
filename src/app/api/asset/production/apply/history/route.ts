import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '@/lib/jwt';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: 'No Token' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);

    // URL에서 조회 조건 파라미터 가져오기 (예: ?scope=dept 또는 본인)
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'OWN';

    let whereClause: any = { isArchived: false }; // 숨김 처리되지 않은 데이터만 조회

    if (scope === 'OWN') {
      whereClause.userEmail = decoded.email;
    } else if (scope === 'DEPT') {
      // 부서 전체 조회를 위해 현재 유저의 부서명을 DB에서 다시 확인
      const user = await prisma.user.findUnique({
        where: { email: decoded.email },
        include: { unit: true }
      });
      whereClause.deptName = user?.unit?.unit_name || 'Unknown';
    }

    // 최신 신청순으로 데이터 가져오기
    const histories = await prisma.productionRequest.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(histories);

  } catch (error) {
    console.error("History Fetch Error:", error);
    return NextResponse.json({ message: '데이터 조회 중 오류 발생' }, { status: 500 });
  }
}