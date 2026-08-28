import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  tryGetSessionUser,
  requireLv1SessionUser,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { isValidOrgUnitCode, normalizeOrgUnitCode } from '@/lib/org-unit-code';

export const dynamic = 'force-dynamic';

/** 공개(비로그인) 응답 — 가입 폼용. users 등 PII 제외 */
function toPublicUnit(u: any) {
  return {
    id: u.id,
    unit_name: u.unit_name,
    unit_name_en: u.unit_name_en,
    unit_code: u.unit_code,
    unit_type: u.unit_type,
    parent_id: u.parent_id,
    sort_order: u.sort_order,
    is_active: u.is_active,
    parent: u.parent
      ? {
          id: u.parent.id,
          unit_name: u.parent.unit_name,
          unit_type: u.parent.unit_type,
        }
      : null,
  };
}

async function assertUniqueUnitCode(code: string, excludeId?: string) {
  const existing = await prisma.orgUnit.findFirst({
    where: {
      unit_code: code,
      is_deleted: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, unit_name: true },
  });
  if (existing) {
    const err = new Error(`조직코드 "${code}"는 이미 사용 중입니다. (${existing.unit_name})`);
    (err as Error & { code: string }).code = 'DUPLICATE_UNIT_CODE';
    throw err;
  }
}

function parseUnitCodeInput(raw: unknown, required = false): string {
  const code = normalizeOrgUnitCode(String(raw ?? ''));
  if (!code) {
    if (required) throw new Error('조직코드(unit_code)는 필수입니다.');
    return '';
  }
  if (!isValidOrgUnitCode(code)) {
    throw new Error('조직코드는 영문·숫자 2~8자로 입력해 주세요. (예: PMD, PMC)');
  }
  return code;
}

// [GET] 조직 목록
// - 비로그인: active=true 일 때만 공개 필드 (회원가입용)
// - 로그인: 전체 조회 + LV_2 담당자명(users) 포함 가능
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('active') === 'true';
    const sessionUser = await tryGetSessionUser();

    // 비로그인: 활성 조직 공개 목록만 (가입·셀렉트용). 전체 목록/담당자 노출 금지
    if (!sessionUser) {
      if (!activeOnly) {
        return NextResponse.json(
          { message: '로그인 후 이용할 수 있습니다.' },
          { status: 401 }
        );
      }
      const publicUnits = await prisma.orgUnit.findMany({
        where: { is_deleted: false, is_active: true },
        include: { parent: true },
        orderBy: { sort_order: 'asc' },
      });
      return NextResponse.json(publicUnits.map(toPublicUnit));
    }

    const units = await prisma.orgUnit.findMany({
      where: {
        is_deleted: false,
        ...(activeOnly ? { is_active: true } : {}),
      },
      include: {
        parent: true,
        users: {
          where: { roles: { array_contains: 'LV_2' } },
          select: { name: true },
        },
      },
      orderBy: { sort_order: 'asc' },
    });
    return NextResponse.json(units);
  } catch (error) {
    return NextResponse.json({ message: '조직 데이터 로드 실패' }, { status: 500 });
  }
}

// [POST] 신규 조직 추가 — LV_1만
export async function POST(req: Request) {
  try {
    await requireLv1SessionUser();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const unit_code = parseUnitCodeInput(body.unit_code, true);
    await assertUniqueUnitCode(unit_code);

    const newUnit = await prisma.orgUnit.create({
      data: {
        unit_name: body.unit_name,
        unit_name_en: body.unit_name_en || '',
        unit_code,
        unit_type: body.unit_type,
        parent_id: body.parent_id || null,
        sort_order: Number(body.sort_order) || 0,
      },
    });
    return NextResponse.json(newUnit);
  } catch (error: any) {
    console.error('조직 생성 실패:', error);
    if (error?.code === 'DUPLICATE_UNIT_CODE' || error?.message?.includes('조직코드')) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: '조직 생성 실패' }, { status: 500 });
  }
}

// [PATCH] 조직 정보 수정 — LV_1만
export async function PATCH(req: Request) {
  try {
    await requireLv1SessionUser();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { id, ...updateData } = await req.json();

    if (updateData.sort_order !== undefined) {
      updateData.sort_order = Number(updateData.sort_order);
    }

    if (updateData.unit_code !== undefined) {
      const unit_code = parseUnitCodeInput(updateData.unit_code, true);
      await assertUniqueUnitCode(unit_code, id);
      updateData.unit_code = unit_code;
    }

    const updated = await prisma.orgUnit.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('수정 실패:', error);
    if (error?.code === 'DUPLICATE_UNIT_CODE' || error?.message?.includes('조직코드')) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 조직 삭제 — LV_1만
export async function DELETE(req: Request) {
  try {
    await requireLv1SessionUser();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { id } = await req.json();

    const childCount = await prisma.orgUnit.count({
      where: { parent_id: id, is_deleted: false },
    });
    if (childCount > 0) {
      return NextResponse.json(
        { message: '하위 조직이 존재하여 삭제할 수 없습니다.' },
        { status: 400 }
      );
    }

    const userCount = await prisma.user.count({
      where: { unit_id: id },
    });
    if (userCount > 0) {
      return NextResponse.json(
        { message: '소속된 사용자가 있어 삭제할 수 없습니다.' },
        { status: 400 }
      );
    }

    await prisma.orgUnit.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: any) {
    console.error('삭제 처리 에러:', error);
    return NextResponse.json(
      { message: '삭제 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
