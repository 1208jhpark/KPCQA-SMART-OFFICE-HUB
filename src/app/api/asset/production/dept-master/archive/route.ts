import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { batchId } = body; // 묶음 ID 단위로 일괄 아카이빙 처리

    if (!batchId) {
      return NextResponse.json({ message: '묶음 번호가 필요합니다.' }, { status: 400 });
    }

    // 정산 완료(VERIFIED)된 대상 건들을 아카이브 처리하여 숨김
    await prisma.productionRequest.updateMany({
      where: {
        batchId: batchId,
        status: 'VERIFIED'
      },
      data: {
        isArchived: true
      }
    });

    return NextResponse.json({ message: '해당 발주 묶음이 성공적으로 보관함으로 이관되었습니다.' });
  } catch (error) {
    console.error("Archiving Error:", error);
    return NextResponse.json({ message: '아카이브 이관 중 오류' }, { status: 500 });
  }
}