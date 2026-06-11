import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * [GET] 시스템 글로벌 설정 불러오기
 * - 홈 화면 헤드라인, 레이아웃, 그리고 핵심인 '실사 기준일'을 가져옵니다.
 * - 만약 'global' 설정이 없다면 기본값을 생성하여 반환합니다.
 */
export async function GET() {
  try {
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
    console.error("Config GET Error:", error);
    return NextResponse.json({ message: '설정 로드 실패' }, { status: 500 });
  }
}

/**
 * [PATCH] 시스템 글로벌 설정 수정하기
 * - 마스터 대시보드에서 보낸 'audit_baseline' 등의 변경 사항을 DB에 저장합니다.
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    // 🚀 전송된 모든 필드(헤드라인, 날짜 등)를 'global' ID를 가진 레코드에 업데이트합니다.
    const updated = await prisma.systemConfig.update({
      where: { id: 'global' },
      data: body
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Config PATCH Error:", error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}