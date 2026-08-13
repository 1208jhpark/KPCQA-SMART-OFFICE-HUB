import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, assertSupplyOwnerDeptsEditable, authErrorToResponse } from '@/lib/server-auth-guard';
import { parseSupplyOwnerDepts } from '@/utils/orgUnits';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/archive';

/** 영구 삭제 — 역할 LV_1만 (메뉴 Master 제외) */
function assertLv1(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  if (auth.permission.myRole === 'LV_1') return;
  throw new Error('FORBIDDEN_ADMIN');
}

/** 복구 시 폐기 JSON 메타 제거 (s_unit·note 등은 유지) */
function stripDisposalMeta(description: string | null | undefined) {
  let ext: Record<string, unknown> = {};
  try {
    ext = JSON.parse(description || '{}');
  } catch {
    ext = {};
  }
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return description || '{}';
  const {
    disposal_date: _d,
    disposal_reason: _r,
    disposer_dept: _dd,
    disposer_name: _dn,
    disposer_email: _de,
    ...rest
  } = ext as Record<string, unknown>;
  return JSON.stringify(rest);
}

/** [GET] 폐기(비활성) 품목 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const archivedItems = await prisma.supplyItem.findMany({
      where: { is_active: false },
      select: {
        id: true,
        name: true,
        description: true,
        current_stock: true,
        owner_dept: true,
        unit_price: true,
        alert_qty: true,
        category: true,
        is_active: true,
        is_published: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(archivedItems);
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/archive GET]', error);
    return NextResponse.json({ error: '아카이브 로드 실패' }, { status: 500 });
  }
}

/** [PATCH] 폐기 품목 복구 — 대시보드와 동일하게 owner_dept 편집 스코프 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (existing.is_active) {
      return NextResponse.json({ success: true, message: '이미 운영 중 품목입니다.' });
    }

    assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(existing.owner_dept));

    const updated = await prisma.supplyItem.update({
      where: { id },
      data: {
        is_active: true,
        description: stripDisposalMeta(existing.description),
      },
    });
    return NextResponse.json({ success: true, message: '복구 완료', data: updated });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/archive PATCH]', error);
    return NextResponse.json({ error: '복구 처리 실패' }, { status: 500 });
  }
}

/** [DELETE] 영구 삭제 — LV_1만, 폐기 상태 품목만 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    assertLv1(auth);

    const { searchParams } = new URL(req.url);
    let id = searchParams.get('id');

    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch {
        /* ignore */
      }
    }

    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (existing.is_active) {
      return NextResponse.json(
        { error: '운영 중 품목은 아카이브 API로 삭제할 수 없습니다. 먼저 폐기 처리하세요.' },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.supplyPurchase.deleteMany({ where: { item_id: id } }),
      prisma.supplyRequest.deleteMany({ where: { item_id: id } }),
      prisma.supplyItem.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true, message: '영구 삭제 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/archive DELETE]', error);
    return NextResponse.json({ error: '삭제 처리 실패' }, { status: 500 });
  }
}
