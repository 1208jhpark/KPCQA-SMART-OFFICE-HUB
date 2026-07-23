import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse, requireSessionUser } from '@/lib/server-auth-guard';

/**
 * [GET] 시스템 글로벌 설정 불러오기
 * - 홈·서비스 화면에서도 사용 → 로그인만 필수 (LV_1 잠금 금지)
 * - 비로그인 공개 차단
 */
export async function GET() {
  try {
    await requireSessionUser();

    let config = await prisma.systemConfig.findUnique({ 
      where: { id: 'global' } 
    });

    // 만약 최초 실행이라 설정 데이터가 없다면 기본 레코드를 생성합니다.
    if (!config) {
      config = await prisma.systemConfig.create({
        data: {
          id: 'global',
          main_headline: "SMART OFFICE HUB",
          sub_headline: "KPCQA 통합 자산 및 업무 관리 시스템",
          home_grid_cols: 4,
          layout_type: "horizontal",
          audit_baseline: "" // 초기에는 빈 값으로 설정하여 하드코딩을 방지합니다.
        }
      });
    }

    return NextResponse.json(config, {
      headers: { 'Cache-Control': 'no-store' } // 실시간 데이터 연동을 위해 캐시 방지
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error("Config GET Error:", error);
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

/**
 * [PATCH] 시스템 글로벌 설정 수정하기 — LV_1만
 */
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();
    const body = await req.json();
    
    // 💡 [화이트리스트 보정완료]: 새롭게 추가한 직책/직급 그룹 및 화면상의 외주 필드들 완벽 장착
    const allowedFields = [
      'main_headline', 'sub_headline', 'home_grid_cols', 'layout_type', 
      'audit_baseline', 'client_category_group', 'supply_category_group', 
      'unit_category_group', 'it_category_group', 'it_rental_group', 
      'it_master_group', 
      'global_mgmt_dept',
      'linked_sites',
      // 🤝 [신설] 인사 관리 및 명함 연동 필드 가드 통과
      'job_duty_group', 'job_grade_group',
      // 🤝 [신설] 외주 업무 서비스 연동 필드 가드 통과
      'outsourcing_vendor_group', 'outsourcing_item_group', 
      'outsourcing_detail1_group', 'outsourcing_detail2_group'
    ];
    
    const updateData: any = {};
    allowedFields.forEach(key => {
      if (body.hasOwnProperty(key)) {
        // 🚀 [정합성 가드]: linked_sites 데이터가 배열이나 객체 형태로 올 경우 Prisma Json 규격에 맞게 자동 정제
        if (key === 'linked_sites' && typeof body[key] === 'string') {
          try {
            updateData[key] = JSON.parse(body[key]);
          } catch (e) {
            updateData[key] = body[key];
          }
        } else {
          updateData[key] = body[key];
        }
      }
    });
     
    const updated = await prisma.systemConfig.update({
      where: { id: 'global' },
      data: updateData
    });
     
    return NextResponse.json(updated);
  } catch (error: any) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("🔥 [시스템 설정 PATCH DB 에러 상세]:", error.message || error);
    return NextResponse.json({ message: '저장 실패', error: error.message }, { status: 500 });
  }
}
