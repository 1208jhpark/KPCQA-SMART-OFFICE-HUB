import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; //

// [GET] 전체 사용자 목록 호출 (부서 활성 상태 포함)
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      include: {
        unit: {
          select: { id: true, unit_name: true, is_active: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // 통계 데이터 (추후 사용자 관리 대시보드용)
    const stats = { totalUsers: await prisma.user.count() };
    
    // 객체 형태로 포장하여 반환 { users: [...], stats: {...} }
    return NextResponse.json(
      { users, stats }, 
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error("사용자 로드 에러:", error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// [PATCH] 사용자 정보 수정 (상태, 부서, 권한 등)
export async function PATCH(req: Request) {
  try {
    const { userId, ...updateData } = await req.json();
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("수정 에러:", error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 사용자 완전 삭제
export async function DELETE(req: Request) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    console.error("삭제 에러:", error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}