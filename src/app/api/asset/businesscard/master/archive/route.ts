import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// [GET] 종결/보관 처리된 명함 아카이브 누적 로그 조회
export async function GET() {
  try {
    // 💡 스키마 필드 완벽 해제: adminStatus 기준 최종 완료 및 예외 필터들만 아카이브로 간주 조회
    const historicalArchives = await prisma.businessCardRequest.findMany({
      where: {
        adminStatus: { in: ['발주완료', '지급완료', '보완요청'] }
      },
      orderBy: { processedAt: 'desc' }
    });

    return NextResponse.json(historicalArchives, {
      headers: { 'Cache-Control': 'no-store, max-age=0' }
    });
  } catch (error) {
    console.error("아카이브 데이터 호출 실패:", error);
    return NextResponse.json({ message: '아카이브 데이터 로드 실패' }, { status: 500 });
  }
}