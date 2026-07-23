import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/archive';

function assertLv1(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  if (auth.permission.isMaster || auth.permission.myRole === 'LV_1') return;
  throw new Error('FORBIDDEN_ADMIN');
}

/** [GET] 폐기(비활성) 품목 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const archivedItems = await prisma.supplyItem.findMany({
      where: { is_active: false },
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

/** [PATCH] 폐기 품목 복구 (is_active: true) */
export async function PATCH(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
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

    const updated = await prisma.supplyItem.update({
      where: { id },
      data: { is_active: true },
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
