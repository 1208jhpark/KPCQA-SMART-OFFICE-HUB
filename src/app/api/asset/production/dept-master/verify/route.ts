import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { requestId, finalPrice } = body;

    if (!requestId || finalPrice === undefined) {
      return NextResponse.json({ message: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    // 최종 확정 단가 검수 및 정산 상태 변경
    const updatedRequest = await prisma.productionRequest.update({
      where: { id: requestId },
      data: {
        finalPrice: Number(finalPrice),
        status: 'VERIFIED' // 단가 대조 검증 완료 단계로 업데이트
      }
    });

    return NextResponse.json({ message: '성공적으로 정산 단가 대조가 승인되었습니다.', data: updatedRequest });
  } catch (error) {
    console.error("Verify Error:", error);
    return NextResponse.json({ message: '검증 처리 중 오류' }, { status: 500 });
  }
}