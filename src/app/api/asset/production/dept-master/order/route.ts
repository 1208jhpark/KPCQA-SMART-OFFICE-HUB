import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { getKSTDateString } from '@/utils/dateUtils';

import { JWT_SECRET } from '@/lib/jwt';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const body = await req.json();
    const { requestIds } = body; // 다중 발주를 처리할 ProductionRequest ID 배열

    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json({ message: '발주할 항목을 선택해주세요.' }, { status: 400 });
    }

    // 부서 관리자의 최신 소속 부서 가져오기
    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: true }
    });
    const deptName = user?.unit?.unit_name || '경영기획';

    // 묶음 번호 생성 (예: BATCH-경영기획-20260714-001)
    const todayStr = getKSTDateString().replace(/-/g, '');
    const batchPrefix = `BATCH-${deptName}-${todayStr}`;
    
    const samePrefixCount = await prisma.productionRequest.groupBy({
      by: ['batchId'],
      where: { batchId: { startsWith: batchPrefix } }
    });
    const sequence = String(samePrefixCount.length + 1).padStart(3, '0');
    const newBatchId = `${batchPrefix}-${sequence}`;

    // 선택된 신청건들의 상태를 ORDERED로 변경하고 batchId 할당
    await prisma.productionRequest.updateMany({
      where: {
        id: { in: requestIds },
        status: 'PENDING' // 대기중인 것만 발주 처리 가능
      },
      data: {
        status: 'ORDERED',
        batchId: newBatchId
      }
    });

    return NextResponse.json({ message: '묶음 발주 처리가 완료되었습니다.', batchId: newBatchId });
  } catch (error) {
    console.error("Batch Order Error:", error);
    return NextResponse.json({ message: '발주 처리 중 서버 오류' }, { status: 500 });
  }
}