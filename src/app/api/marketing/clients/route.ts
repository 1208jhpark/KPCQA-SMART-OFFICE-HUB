import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingApi,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

export async function GET() {
  try {
    await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const clients = await prisma.marketingClient.findMany({
      include: { distributions: { include: { item: true } } },
      orderBy: { name: 'asc' },
    });
    // 레거시: is_active=false 만 있던 건은 보관함으로 취급
    const shaped = clients.map((c) => ({
      ...c,
      is_archived: Boolean(c.is_archived) || c.is_active === false,
    }));
    return NextResponse.json(shaped);
  } catch (error) {
    return NextResponse.json({ error: '고객사 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    // 신규 등록: 메뉴 접근만 (interface 편집자 조건 제외)
    auth = await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { name, location, category } = await req.json();
    const newClient = await prisma.marketingClient.create({
      data: {
        name,
        location,
        category,
        departments: [{ name: '전사', is_hidden: false }],
        is_active: true,
        is_archived: false,
        creator_name: auth.user.name || null,
        creator_dept: auth.user.unit?.unit_name || null,
        creator_email: auth.user.email || null,
      },
    });
    return NextResponse.json(newClient);
  } catch (error) {
    return NextResponse.json({ error: '고객사 등록 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const {
      id,
      name,
      location,
      category,
      departments,
      oldDeptName,
      newDeptName,
      action,
      targetDeptName,
      is_archived,
    } = body;

    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const clientBefore = await prisma.marketingClient.findUnique({ where: { id } });
    if (!clientBefore) return NextResponse.json({ error: '고객사 미존재' }, { status: 404 });

    if (action === 'delete_dept' && targetDeptName) {
      const distributionCount = await prisma.marketingDistribution.count({
        where: { client_id: id, client_dept: targetDeptName },
      });
      if (distributionCount > 0) {
        return NextResponse.json(
          { error: `해당 부서는 ${distributionCount}건의 지급 이력이 있어 삭제할 수 없습니다.` },
          { status: 400 }
        );
      }
      const currentDepts = Array.isArray(clientBefore.departments)
        ? (clientBefore.departments as any[])
        : [];
      const updatedDepts = currentDepts.filter(
        (d) => (typeof d === 'string' ? d : d.name) !== targetDeptName
      );
      const updated = await prisma.marketingClient.update({
        where: { id },
        data: { departments: updatedDepts },
      });
      return NextResponse.json(updated);
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (location !== undefined) data.location = location;
    if (category !== undefined) data.category = category;
    if (departments !== undefined) data.departments = departments;

    // 보관 / 복구 — 처리자·처리일 기록 (세션 기준). email은 저장만, UI 미표시
    if (is_archived === true && !clientBefore.is_archived) {
      data.is_archived = true;
      data.is_active = true;
      data.archived_at = new Date();
      data.archived_by_name = auth.user.name || null;
      data.archived_by_dept = auth.user.unit?.unit_name || null;
      data.archived_by_email = auth.user.email || null;
    } else if (is_archived === false) {
      data.is_archived = false;
      data.is_active = true;
      data.archived_at = null;
      data.archived_by_name = null;
      data.archived_by_dept = null;
      data.archived_by_email = null;
    } else if (is_archived === true) {
      data.is_archived = true;
      data.is_active = true;
    }

    const updatedClient = await prisma.marketingClient.update({
      where: { id },
      data,
    });

    if (name && clientBefore.name !== name) {
      await prisma.marketingDistribution.updateMany({
        where: { client_id: id },
        data: { client_name: name },
      });
    }

    if (oldDeptName && newDeptName) {
      await prisma.marketingDistribution.updateMany({
        where: { client_id: id, client_dept: oldDeptName },
        data: { client_dept: newDeptName },
      });
    }

    return NextResponse.json(updatedClient);
  } catch (error) {
    return NextResponse.json({ error: '업데이트 실패' }, { status: 500 });
  }
}

/**
 * 영구 삭제 (지급 이력 있으면 거부).
 * 허용: LV_1 · 메뉴 마스터 · 등록자 본인(creator_email)
 * 보관은 PATCH is_archived
 */
export async function DELETE(req: Request) {
  let auth;
  try {
    // 등록자 본인 삭제를 위해 편집자 필수는 아님 (메뉴 접근만)
    auth = await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

  const existing = await prisma.marketingClient.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: '고객사 미존재' }, { status: 404 });

  const isPower =
    auth.permission.myRole === 'LV_1' || auth.permission.isMaster;
  const isCreator = emailsEqual(
    (existing as { creator_email?: string | null }).creator_email,
    auth.user.email
  );
  if (!isPower && !isCreator) {
    return NextResponse.json(
      { error: '영구 삭제는 등록자 본인 또는 LV_1·마스터만 가능합니다.' },
      { status: 403 }
    );
  }

  const distCount = await prisma.marketingDistribution.count({ where: { client_id: id } });
  if (distCount > 0) {
    return NextResponse.json(
      { error: `지급 이력이 ${distCount}건 있어 영구 삭제할 수 없습니다. 보관 처리만 가능합니다.` },
      { status: 400 }
    );
  }

  await prisma.marketingClient.delete({ where: { id } });
  return NextResponse.json({ message: '영구 삭제 완료' });
}
