import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';
import { generateTempPassword } from '@/utils/tempPassword';

const USER_UPDATE_WHITELIST = [
  'name',
  'name_en',
  'employee_no',
  'unit_id',
  'duty',
  'duty_en',
  'grade',
  'grade_en',
  'roles',
  'status',
] as const;

function pickUserUpdate(raw: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of USER_UPDATE_WHITELIST) {
    if (key in raw) data[key] = raw[key];
  }
  return data;
}

// ==========================================
// [GET] 전체 사용자 목록 및 지정 마스터 그룹 데이터 연동 호출
// ==========================================
export async function GET() {
  try {
    await authorizeAdminApi();

    // 1. 활성 사용자 및 소속 부서 정보 호출
    const users = await prisma.user.findMany({
      include: {
        unit: {
          select: { id: true, unit_name: true, is_active: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // 2. 시스템 환경 설정 정보 단일 행 조회
    const config = await prisma.systemConfig.findFirst();
    
    let duties: any[] = [];
    let grades: any[] = [];
    
    // 3. 설정에 직책/직급 마스터 그룹이 맵핑되어 있다면 하위 활성 코드를 가져옴
    if (config) {
      if (config.job_duty_group) {
        duties = await prisma.masterCode.findMany({
          where: { group_id: config.job_duty_group, is_active: true, is_archived: false },
          orderBy: { sort_order: 'asc' }
        });
      }
      if (config.job_grade_group) {
        grades = await prisma.masterCode.findMany({
          where: { group_id: config.job_grade_group, is_active: true, is_archived: false },
          orderBy: { sort_order: 'asc' }
        });
      }
    }

    // 통계 데이터 (추후 사용자 관리 대시보드용)
    const stats = { totalUsers: await prisma.user.count() };
    
    // 💡 프론트엔드가 한 번에 파싱해서 그릴 수 있도록 포장하여 반환
    return NextResponse.json(
      { users, stats, duties, grades }, 
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("사용자 로드 에러:", error);
    return NextResponse.json({ message: '데이터 로드 실패' }, { status: 500 });
  }
}

// [PATCH] 사용자 정보 수정 / 비밀번호 강제 초기화
export async function PATCH(req: Request) {
  try {
    await authorizeAdminApi();

    const body = await req.json();
    const { userId, action } = body;
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    // 🔐 관리자 강제 비밀번호 초기화
    if (action === 'resetPassword') {
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) {
        return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
      }
      const tempPassword = generateTempPassword(10);
      const hashed = await bcrypt.hash(tempPassword, 10);
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashed,
          must_reset_password: true,
          password_reset_requested: false,
          password_reset_requested_at: null,
        },
      });
      return NextResponse.json({
        message: '임시 비밀번호가 발급되었습니다.',
        tempPassword,
        email: existing.email,
        name: existing.name,
      });
    }

    const updateData = pickUserUpdate(body);

    // 💡 [필수 안전장치] roles 배열이 인입될 경우, Prisma Json 타입에 맞게 문자열 변환 처리
    if (updateData.roles !== undefined) {
      updateData.roles = JSON.stringify(updateData.roles);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '수정할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("수정 에러:", error);
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 사용자 완전 삭제
export async function DELETE(req: Request) {
  try {
    await authorizeAdminApi();

    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ message: '사용자 ID 누락' }, { status: 400 });

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    if (error instanceof Error) {
      const res = authErrorToResponse(error);
      if (res.status !== 500) return res;
    }
    console.error("삭제 에러:", error);
    return NextResponse.json({ message: '삭제 실패' }, { status: 500 });
  }
}
