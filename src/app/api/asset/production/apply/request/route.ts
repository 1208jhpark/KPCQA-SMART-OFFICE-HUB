import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { nextProductionPostNumber } from '@/lib/production-post-number';
import { normalizeOrgUnitCode } from '@/lib/org-unit-code';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/production/apply/request';

/** [POST] 제작물 신청 — 메뉴 Access (신청은 Edit 불필요) */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH);
    const user = auth.user;

    const unitRow = user.unit_id
      ? await prisma.orgUnit.findUnique({
          where: { id: user.unit_id },
          select: {
            id: true,
            unit_code: true,
            unit_name: true,
            parent: { select: { id: true, unit_name: true } },
          },
        })
      : null;

    const body = await req.json();
    const { category, projectName, quantity, options, estimatedPrice } = body;

    if (!category || !projectName || !quantity) {
      return NextResponse.json(
        { message: '필수 입력값이 누락되었습니다. (품목 분류, 프로젝트명, 수량)' },
        { status: 400 }
      );
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
            unitId: unitRow?.id || user.unit_id || null,
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

    return NextResponse.json(
      { message: '성공적으로 신청되었습니다.', data: newRequest },
      { status: 201 }
    );
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('Production Request Error:', error);
    return NextResponse.json({ message: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
