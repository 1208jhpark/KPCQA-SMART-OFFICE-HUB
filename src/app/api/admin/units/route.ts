import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  tryGetSessionUser,
  requireLv1SessionUser,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { isValidOrgUnitCode, normalizeOrgUnitCode } from '@/lib/org-unit-code';

export const dynamic = 'force-dynamic';

const UNIT_TYPES = new Set(['ORGANIZATION', 'HQ', 'CENTER', 'DEPT']);

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

function parseUnitType(raw: unknown): string {
  const t = String(raw ?? '').trim().toUpperCase();
  if (!UNIT_TYPES.has(t)) {
    throw new Error('조직 유형은 ORGANIZATION / HQ / CENTER / DEPT 중 하나여야 합니다.');
  }
  return t;
}

function parseUnitName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name) throw new Error('조직 명칭(국문)을 입력해 주세요.');
  return name;
}

/** soft-delete 후 같은 코드 재사용을 위해 unique 슬롯 해제 */
function freedUnitCode(id: string): string {
  const suffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(-10) || 'X';
  return `Z${suffix}`.slice(0, 8).toUpperCase();
}

async function assertUniqueUnitCode(
  code: string,
  excludeId?: string,
  client: typeof prisma = prisma
) {
  const existing = await client.orgUnit.findFirst({
    where: {
      unit_code: code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, unit_name: true, is_deleted: true },
  });
  if (existing) {
    const hint = existing.is_deleted ? '삭제된 조직' : existing.unit_name;
    const err = new Error(`조직코드 "${code}"는 이미 사용 중입니다. (${hint})`);
    (err as Error & { code: string }).code = 'DUPLICATE_UNIT_CODE';
    throw err;
  }
}

async function assertValidParent(
  parentId: string | null,
  selfId: string | undefined,
  client: typeof prisma = prisma
) {
  if (!parentId) return;

  if (selfId && parentId === selfId) {
    throw new Error('자기 자신을 상위 조직으로 지정할 수 없습니다.');
  }

  const parent = await client.orgUnit.findFirst({
    where: { id: parentId, is_deleted: false },
    select: { id: true, is_active: true },
  });
  if (!parent) {
    throw new Error('상위 조직을 찾을 수 없습니다.');
  }
  if (parent.is_active === false) {
    throw new Error('미사용 조직은 상위로 지정할 수 없습니다.');
  }

  // 순환 방지: 부모 체인에 self가 있으면 불가
  if (selfId) {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === selfId) {
        throw new Error('하위 조직을 상위로 지정할 수 없습니다. (순환 구조)');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const row: { parent_id: string | null } | null = await client.orgUnit.findFirst({
        where: { id: cursor, is_deleted: false },
        select: { parent_id: true },
      });
      cursor = row?.parent_id ?? null;
    }
  }
}

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

// [GET] 조직 목록 — 로그인 필요
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('active') === 'true';
    const sessionUser = await tryGetSessionUser();

    if (!sessionUser) {
      return NextResponse.json(
        { message: '로그인 후 이용할 수 있습니다.' },
        { status: 401 }
      );
    }

    const units = await prisma.orgUnit.findMany({
      where: {
        is_deleted: false,
        ...(activeOnly ? { is_active: true } : {}),
      },
      include: {
        parent: true,
        _count: {
          select: {
            users: true,
            children: { where: { is_deleted: false } },
          },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { unit_name: 'asc' }],
    });

    // 같은 응답 집합 기준 사용 중 하위 수 (미사용 차단용)
    const activeChildCountByParent = new Map<string, number>();
    for (const u of units) {
      if (u.is_active === false || !u.parent_id) continue;
      activeChildCountByParent.set(
        u.parent_id,
        (activeChildCountByParent.get(u.parent_id) || 0) + 1
      );
    }

    return NextResponse.json(
      units.map(({ _count, ...rest }) => ({
        ...rest,
        member_count: _count.users,
        child_count: _count.children,
        active_child_count: activeChildCountByParent.get(rest.id) || 0,
      }))
    );
  } catch (error) {
    console.error('조직 데이터 로드 실패:', error);
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
    const unit_name = parseUnitName(body.unit_name);
    const unit_name_en = String(body.unit_name_en ?? '').trim();
    const unit_code = parseUnitCodeInput(body.unit_code, true);
    const unit_type = parseUnitType(body.unit_type);
    let parent_id: string | null =
      body.parent_id && String(body.parent_id).trim()
        ? String(body.parent_id).trim()
        : null;

    if (unit_type === 'ORGANIZATION') {
      parent_id = null;
    }

    await assertUniqueUnitCode(unit_code);
    await assertValidParent(parent_id, undefined);

    const maxSort = await prisma.orgUnit.aggregate({
      where: { is_deleted: false },
      _max: { sort_order: true },
    });
    const sort_order =
      body.sort_order !== undefined && body.sort_order !== ''
        ? Number(body.sort_order) || 0
        : (maxSort._max.sort_order ?? 0) + 10;

    const newUnit = await prisma.orgUnit.create({
      data: {
        unit_name,
        unit_name_en,
        unit_code,
        unit_type,
        parent_id,
        sort_order,
        is_active: true,
      },
    });
    return NextResponse.json(newUnit);
  } catch (error: any) {
    console.error('조직 생성 실패:', error);
    if (
      error?.code === 'DUPLICATE_UNIT_CODE' ||
      error?.code === 'P2002' ||
      /조직코드|조직 명칭|조직 유형|상위 조직|자기 자신|순환/.test(String(error?.message || ''))
    ) {
      return badRequest(error.message || '조직 생성 실패');
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
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return badRequest('조직 ID가 필요합니다.');

    const existing = await prisma.orgUnit.findFirst({
      where: { id, is_deleted: false },
    });
    if (!existing) {
      return NextResponse.json({ message: '조직을 찾을 수 없습니다.' }, { status: 404 });
    }

    const allowed = [
      'unit_name',
      'unit_name_en',
      'unit_code',
      'unit_type',
      'parent_id',
      'sort_order',
      'is_active',
    ] as const;

    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        data[key] = body[key];
      }
    }

    if (data.unit_name !== undefined) {
      data.unit_name = parseUnitName(data.unit_name);
    }
    if (data.unit_name_en !== undefined) {
      data.unit_name_en = String(data.unit_name_en ?? '').trim();
    }
    if (data.sort_order !== undefined) {
      data.sort_order = Number(data.sort_order) || 0;
    }
    if (data.unit_type !== undefined) {
      data.unit_type = parseUnitType(data.unit_type);
    }
    if (data.is_active !== undefined) {
      data.is_active = Boolean(data.is_active);
    }

    if (data.parent_id === '') {
      data.parent_id = null;
    }

    const nextType = (data.unit_type as string | undefined) ?? existing.unit_type;
    if (nextType === 'ORGANIZATION') {
      data.parent_id = null;
    }

    if (data.parent_id !== undefined && data.parent_id !== null) {
      await assertValidParent(String(data.parent_id), id);
    }

    if (data.unit_code !== undefined) {
      const unit_code = parseUnitCodeInput(data.unit_code, true);
      await assertUniqueUnitCode(unit_code, id);
      data.unit_code = unit_code;
    }

    // 미사용으로 내릴 때: 사용 중 하위가 있으면 차단
    if (data.is_active === false) {
      const activeChildCount = await prisma.orgUnit.count({
        where: { parent_id: id, is_deleted: false, is_active: true },
      });
      if (activeChildCount > 0) {
        return badRequest(
          `사용 중인 하위 조직이 ${activeChildCount}개 있어 미사용으로 옮길 수 없습니다. 하위를 먼저 정리해 주세요.`
        );
      }
    }

    if (Object.keys(data).length === 0) {
      return badRequest('수정할 항목이 없습니다.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const unit = await tx.orgUnit.update({
        where: { id },
        data,
      });

      if (data.is_active === false) {
        await tx.user.updateMany({
          where: { unit_id: id },
          data: { unit_id: null },
        });
      }

      return unit;
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('수정 실패:', error);
    if (
      error?.code === 'DUPLICATE_UNIT_CODE' ||
      error?.code === 'P2002' ||
      /조직코드|조직 명칭|조직 유형|상위 조직|자기 자신|순환|미사용/.test(
        String(error?.message || '')
      )
    ) {
      return badRequest(error.message || '수정 실패');
    }
    return NextResponse.json({ message: '수정 실패' }, { status: 500 });
  }
}

// [DELETE] 조직 삭제 — LV_1만 (미사용 아카이브에서만)
export async function DELETE(req: Request) {
  try {
    await requireLv1SessionUser();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { id } = await req.json();
    const unitId = String(id || '').trim();
    if (!unitId) return badRequest('조직 ID가 필요합니다.');

    const unit = await prisma.orgUnit.findFirst({
      where: { id: unitId, is_deleted: false },
    });
    if (!unit) {
      return NextResponse.json({ message: '조직을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (unit.is_active !== false) {
      return badRequest('먼저 미사용으로 옮긴 뒤 삭제할 수 있습니다.');
    }

    const childCount = await prisma.orgUnit.count({
      where: { parent_id: unitId, is_deleted: false },
    });
    if (childCount > 0) {
      return badRequest(
        '하위 조직이 존재하여 삭제할 수 없습니다. 하위 조직을 먼저 정리해 주세요.'
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { unit_id: unitId },
        data: { unit_id: null },
      });

      // soft-delete + unit_code 슬롯 해제 (동일 코드 재생성 가능)
      let freeCode = freedUnitCode(unitId);
      const clash = await tx.orgUnit.findFirst({
        where: { unit_code: freeCode, id: { not: unitId } },
        select: { id: true },
      });
      if (clash) {
        freeCode = `Z${Date.now().toString(36)}`.slice(0, 8).toUpperCase();
      }

      await tx.orgUnit.update({
        where: { id: unitId },
        data: { is_deleted: true, unit_code: freeCode },
      });
    });

    return NextResponse.json({ message: '삭제 완료' });
  } catch (error: any) {
    console.error('삭제 처리 에러:', error);
    if (error?.code === 'P2002') {
      return badRequest('조직코드 정리 중 충돌이 발생했습니다. 다시 시도해 주세요.');
    }
    return NextResponse.json(
      { message: '삭제 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
