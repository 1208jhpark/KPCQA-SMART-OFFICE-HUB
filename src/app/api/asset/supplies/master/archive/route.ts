import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
export const dynamic = 'force-dynamic';
  
// 🚀 1. 폐기된(is_active: false) 물품만 골라서 가져오기 (GET)
export async function GET() {
  try {
    const archivedItems = await prisma.supplyItem.findMany({
      where: { is_active: false },
      orderBy: { updatedAt: 'desc' } // 최근 수정/폐기된 순
    });
    return NextResponse.json(archivedItems);
  } catch (error) {
    console.error('Archive GET Error:', error);
    return NextResponse.json({ error: '아카이브 로드 실패' }, { status: 500 });
  }
}

// 🚀 2. [신규 추가] 아카이브 자산 영구 삭제 (DELETE)
export async function DELETE(req: Request) {
  try {
    // 1. URL 파라미터(?id=...)에서 ID 추출 (가장 안정적인 방식)
    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');

    // 2. 혹시 Body({ id })로 넘어왔을 경우를 대비한 폴백(Fallback)
    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {
        // Body가 없으면 무시
      }
    }

    // ID가 없으면 에러 반환
    if (!id) {
      return NextResponse.json({ error: '삭제할 자산의 ID가 전달되지 않았습니다.' }, { status: 400 });
    }

    // DB에서 해당 물품 데이터를 아예 영구적으로 파기합니다.
    await prisma.supplyItem.delete({
      where: { id }
    });

    return NextResponse.json({ success: true, message: '아카이브에서 영구 삭제되었습니다.' });
  } catch (error) {
    console.error('Archive DELETE Error:', error);
    return NextResponse.json({ error: '삭제 처리 중 서버 오류 발생' }, { status: 500 });
  }
}