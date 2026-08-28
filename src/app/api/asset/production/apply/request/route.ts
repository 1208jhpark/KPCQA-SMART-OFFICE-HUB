import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { nextProductionPostNumber } from '@/lib/production-post-number';
import { normalizeOrgUnitCode } from '@/lib/org-unit-code';

import { JWT_SECRET } from '@/lib/jwt';

export async function POST(req: Request) {
  try {
    // 1. 서버 사이드 권한/세션 검증 (데이터 위조 방지)
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return NextResponse.json({ message: '인증되지 않은 접근입니다.' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    
    // DB에서 정확한 최신 소속 정보 가져오기
    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      include: { unit: { include: { parent: true } } },
    });

    if (!user) return NextResponse.json({ message: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    // include 캐시·구버전 클라이언트 대비 — unit_code는 OrgUnit에서 직접 재조회
    const unitRow = user.unit_id
      ? await prisma.orgUnit.findUnique({
          where: { id: user.unit_id },
          select: {
            unit_code: true,
            unit_name: true,
            parent: { select: { unit_name: true } },
          },
        })
      : null;

    // 2. 클라이언트 페이로드 수신 및 필수값 검증
    const body = await req.json();
    const { category, projectName, quantity, options, estimatedPrice } = body;

    if (!category || !projectName || !quantity) {
      return NextResponse.json({ message: '필수 입력값이 누락되었습니다. (품목 분류, 프로젝트명, 수량)' }, { status: 400 });
    }

    const unitCode = normalizeOrgUnitCode(unitRow?.unit_code || user.unit?.unit_code);
    if (!unitCode) {
      return NextResponse.json(
        {
          message:
            '소속 조직에 제작물 관리번호용 조직코드(unit_code)가 등록되지 않았습니다. 관리자(/admin/units)에게 문의하세요.',
        },
        { status: 400 }
      );
    }

    // 3. 고유 관리 번호 — 예: P-SUP-PMD-260825-001
    let newRequest = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const newPostNumber = await nextProductionPostNumber(category, unitCode);
      try {
        newRequest = await prisma.productionRequest.create({
          data: {
            postNumber: newPostNumber,
            category: category,
            userEmail: user.email,
            userName: user.name,
            deptHead: unitRow?.parent?.unit_name || user.unit?.parent?.unit_name || '본부 미지정',
            deptName: unitRow?.unit_name || user.unit?.unit_name || '조직 미지정',
            title: projectName,
            quantity: Number(quantity) || 1,
            estimatedPrice: Number(estimatedPrice) || 0,
            status: 'PENDING',
            options: options || {},
          },
        });
        break;
      } catch (err: any) {
        lastError = err;
        // 동시 신청 등으로 번호 충돌 시 다음 순번 재시도
        if (err?.code !== 'P2002') throw err;
      }
    }

    if (!newRequest) {
      console.error('Production Request Error:', lastError);
      return NextResponse.json(
        { message: '관리번호 발급 중 충돌이 발생했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: '성공적으로 신청되었습니다.', data: newRequest }, { status: 201 });

  } catch (error) {
    console.error("Production Request Error:", error);
    return NextResponse.json({ message: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}