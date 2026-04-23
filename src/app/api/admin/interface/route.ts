// src/app/api/admin/interface/route.ts 상단에 추가
export const dynamic = 'force-dynamic'; // 🚨 최신 데이터 강제 로드 설정
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function GET() {
  try {
    const interfaces = await prisma.interfaceConfig.findMany({
      orderBy: { sort_order: 'asc' },
    });
    // 🚨 캐시를 사용하지 않도록 헤더 추가
    return NextResponse.json(interfaces, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });
  } catch (error) {
    return NextResponse.json({ message: '로드 실패' }, { status: 500 });
  }
}
// [POST] 신규 메뉴 등록 (v2.0 통합 권한 반영 및 500 에러 픽스)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 1. 필수 값 및 경로 중복 체크
    if (!body.path) return NextResponse.json({ message: '경로(path) 누락' }, { status: 400 });
    
    const exists = await prisma.interfaceConfig.findUnique({ where: { path: body.path } });
    if (exists) return NextResponse.json({ message: '중복된 경로가 존재합니다.' }, { status: 400 });

    // 2. DB 데이터 생성
    const newMenu = await prisma.interfaceConfig.create({
      data: {
        level: Number(body.level),
        name: body.name,
        path: body.path,
        icon: body.icon || "📦",
        sort_order: Number(body.sort_order) || 0,
        parent_id: body.parent_id || null,
        
        // 🚨 [핵심 해결] 오류의 주범이었던 lv3_view, lv3_edit 등 옛날 코드를 삭제했습니다.
        // 통합 권한(view_scopes, task_masters 등)은 schema.prisma의 @default("[]")가 작동하도록 생략하는 것이 가장 안전합니다.
      }
    });
    return NextResponse.json(newMenu);
  } catch (error: any) {
    // 🚨 500 에러 발생 시, 터미널에 어떤 원인인지 정확히 출력해 주는 안전망
    console.error("🔥 [메뉴 생성 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '등록 실패', error: error.message }, { status: 500 });
  }
}

// [PATCH] 정보 수정 (정렬, 노출, 상태, 권한 등)
export async function PATCH(req: Request) {
  try {
    const { id, ...updateData } = await req.json();
    const updated = await prisma.interfaceConfig.update({
      where: { id },
      data: updateData
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("🔥 [메뉴 수정 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 메뉴 삭제
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ message: 'ID가 필요합니다.' }, { status: 400 });
    
    // 하위 메뉴가 있는지 최종 검증
    const childCount = await prisma.interfaceConfig.count({ where: { parent_id: id } });
    if (childCount > 0) {
      return NextResponse.json({ message: '하위 메뉴가 존재하여 삭제할 수 없습니다.' }, { status: 400 });
    }
    
    await prisma.interfaceConfig.delete({ where: { id } });
    return NextResponse.json({ message: '삭제 성공' });
  } catch (error: any) {
    console.error("🔥 [메뉴 삭제 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '서버 에러' }, { status: 500 });
  }
}