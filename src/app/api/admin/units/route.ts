import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; //

// [GET] 조직 목록 및 소속 Lv.2 관리자 호출
export async function GET(req: Request) {
    try {
      const { searchParams } = new URL(req.url);
      const activeOnly = searchParams.get('active') === 'true';
  
      const units = await prisma.orgUnit.findMany({
        where: { 
          is_deleted: false,
          ...(activeOnly ? { is_active: true } : {}) // [핵심] active=true 일 때만 필터링
        },
        include: {
          parent: true,
          users: {
            where: { roles: { array_contains: 'LV_2' } },
            select: { name: true }
          }
        },
        orderBy: { sort_order: 'asc' }
      });
      return NextResponse.json(units);
    } catch (error) {
      return NextResponse.json({ message: '조직 데이터 로드 실패' }, { status: 500 });
    }
  }
  
// [POST] 신규 조직 추가
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newUnit = await prisma.orgUnit.create({
      data: {
        unit_name: body.unit_name,
        unit_type: body.unit_type, 
        parent_id: body.parent_id || null,
        sort_order: Number(body.sort_order) || 0,
      }
    });
    return NextResponse.json(newUnit);
  } catch (error: any) {
    console.error('조직 생성 실패:', error);
    return NextResponse.json({ message: '조직 생성 실패' }, { status: 500 });
  }
}

// [PATCH] 조직 정보 수정
export async function PATCH(req: Request) {
  try {
    const { id, ...updateData } = await req.json();
    
    // updateData에서 sort_order가 있다면 숫자로 변환해주는 안전장치
    if (updateData.sort_order !== undefined) {
      updateData.sort_order = Number(updateData.sort_order);
    }

    const updated = await prisma.orgUnit.update({
      where: { id },
      data: updateData
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('수정 실패:', error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 조직 삭제 (관계 확인 로직 포함)
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    
    // 1. 하위 조직이 있는지 확인
    const childCount = await prisma.orgUnit.count({ 
      where: { parent_id: id, is_deleted: false } 
    });
    if (childCount > 0) {
      return NextResponse.json({ message: '하위 조직이 존재하여 삭제할 수 없습니다.' }, { status: 400 });
    }

    // 2. 소속 사용자가 있는지 확인
    const userCount = await prisma.user.count({ 
      where: { unit_id: id } 
    });
    if (userCount > 0) {
      return NextResponse.json({ message: '소속된 사용자가 있어 삭제할 수 없습니다.' }, { status: 400 });
    }

    // 3. 실제 삭제 대신 상태값 변경 (Soft Delete)
    await prisma.orgUnit.update({ 
      where: { id }, 
      data: { is_deleted: true } 
    });
    
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: any) {
    console.error('삭제 처리 에러:', error);
    return NextResponse.json({ message: '삭제 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}