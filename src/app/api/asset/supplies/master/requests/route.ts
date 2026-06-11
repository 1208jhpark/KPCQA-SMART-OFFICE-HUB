import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
  
export const dynamic = 'force-dynamic';
  
// 🚀 1. 모든 신청 내역 불러오기
export async function GET() {
  try {
    const requests = await prisma.supplyRequest.findMany({
      include: { item: true },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(requests);
  } catch (error) {
    console.error('Request GET Error:', error);
    return NextResponse.json({ error: '로드 실패' }, { status: 500 });
  }
}
  
// 🚀 2. 신청 내역 처리 (지급완료/반려)
export async function PATCH(req: Request) {
  try {
    const { id, status, admin_opinion, admin_name, admin_dept } = await req.json();
  
    // 💡 참고: UI에서 보낸 관리자 정보를 각각의 필드에 매핑합니다.
    const updated = await prisma.supplyRequest.update({
      where: { id },
      data: { 
        status, 
        admin_opinion, // 별도 컬럼에 저장
        admin_name,    // 처리자 이름 저장
        admin_dept,    // 처리자 부서 저장
        updatedAt: new Date() // 처리 일시 업데이트
      }
    });
    
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Request PATCH Error:', error);
    return NextResponse.json({ error: '처리 실패' }, { status: 500 });
  }
}

// 🚀 3. [신규 추가] 신청 내역 영구 삭제 (DELETE)
export async function DELETE(req: Request) {
  try {
    // 1. 주소창(?id=...)에서 ID 추출 시도
    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');

    // 2. 주소창에 없으면 Body({ id })에서 추출 시도 (프론트엔드 호환성 보장)
    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {
        // body가 없는 경우 무시
      }
    }

    if (!id) {
      return NextResponse.json({ error: '삭제할 ID가 전달되지 않았습니다.' }, { status: 400 });
    }

    // DB에서 해당 레코드 영구 삭제
    await prisma.supplyRequest.delete({
      where: { id }
    });

    return NextResponse.json({ success: true, message: '삭제 완료' });
  } catch (error) {
    console.error('Request DELETE Error:', error);
    return NextResponse.json({ error: '삭제 처리 중 서버 오류 발생' }, { status: 500 });
  }
}