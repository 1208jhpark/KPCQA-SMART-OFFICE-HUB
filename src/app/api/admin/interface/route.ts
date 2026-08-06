export const dynamic = 'force-dynamic'; // 🚨 최신 데이터 강제 로드 설정
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';

export async function GET() {
  try {
    const interfaces = await prisma.interfaceConfig.findMany({
      orderBy: { sort_order: 'asc' },
    });
    // 🚨 캐시를 사용하지 않도록 헤더 추가 — 전 직원 메뉴/권한 조회용 (LV_1 잠금 금지)
    return NextResponse.json(interfaces, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });
  } catch (error) {
    return NextResponse.json({ message: '로드 실패' }, { status: 500 });
  }
}

// [POST] 신규 메뉴 등록 — LV_1만
export async function POST(req: Request) {
  try {
    await authorizeAdminApi();
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
        icon: body.icon != null ? String(body.icon) : '',
        sort_order: Number(body.sort_order) || 0,
        parent_id: body.parent_id || null,
      }
    });
    return NextResponse.json(newMenu);
  } catch (error: any) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("🔥 [메뉴 생성 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '등록 실패', error: error.message }, { status: 500 });
  }
}

// [PATCH] 정보 수정 (정렬, 노출, 상태, 권한 등) — LV_1만
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();
    const { id, ...updateData } = await req.json();

    if ('org_ids' in updateData) {
      const orgIds = Array.isArray(updateData.org_ids)
        ? updateData.org_ids.filter(Boolean)
        : [];
      if (orgIds.length === 0) {
        return NextResponse.json(
          { message: 'Org Guard는 최소 1개 부서를 지정해야 합니다.' },
          { status: 400 }
        );
      }
      updateData.org_ids = orgIds;
    }

    if ('view_scopes' in updateData) {
      const raw = Array.isArray(updateData.view_scopes) ? updateData.view_scopes : [];
      const coded = raw.map(String).includes('CODED');
      const scopes = raw.filter((s: any) =>
        ['OWN', 'DEPT', 'TOTAL'].includes(String(s).toUpperCase())
      );
      if (!coded && scopes.length === 0) {
        return NextResponse.json(
          { message: 'View Scope는 본인/부서/전사 중 최소 1개를 지정해야 합니다. (코드화 시 제외)' },
          { status: 400 }
        );
      }
      // CODED = 관리자용 표시(설정 미적용). 엔진은 OWN/DEPT/TOTAL만 인식
      updateData.view_scopes = coded ? ['CODED', ...scopes] : scopes;
    }

    const updated = await prisma.interfaceConfig.update({
      where: { id },
      data: updateData
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("🔥 [메뉴 수정 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 메뉴 삭제 — LV_1만
export async function DELETE(req: Request) {
  try {
    await authorizeAdminApi();
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
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("🔥 [메뉴 삭제 DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '서버 에러' }, { status: 500 });
  }
}
