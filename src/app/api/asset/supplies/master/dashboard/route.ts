import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeApi, authErrorToResponse } from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/dashboard';

const cleanNum = (val: any) => Number(String(val ?? '').replace(/,/g, '')) || 0;

function assertLv1(auth: Awaited<ReturnType<typeof authorizeApi>>) {
  if (auth.permission.isMaster || auth.permission.myRole === 'LV_1') return;
  throw new Error('FORBIDDEN_ADMIN');
}

function sessionDeptName(user: any) {
  return user?.unit?.unit_name || '소속 부서 없음';
}

/** [GET] 활성 소모품 마스터 + 단위 코드 */
export async function GET() {
  try {
    await authorizeApi(MENU_PATH);

    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    let units: any[] = [];
    if (config?.unit_category_group) {
      const unitGroup = await prisma.masterGroup.findUnique({
        where: { id: config.unit_category_group },
        include: { codes: { where: { is_active: true }, orderBy: { sort_order: 'asc' } } },
      });
      if (unitGroup) units = unitGroup.codes;
    }

    const items = await prisma.supplyItem.findMany({
      where: { is_active: true },
      include: {
        purchases: { orderBy: { purchase_date: 'desc' }, take: 1 },
        requests: { where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ units, items });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard GET]', error);
    return NextResponse.json({ error: '대시보드 로드 실패' }, { status: 500 });
  }
}

/** [POST] 신규 품목 등록 */
export async function POST(req: Request) {
  try {
    await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: '품목명이 필요합니다.' }, { status: 400 });
    }

    const p_qty = cleanNum(body.p_qty) || 1;
    const sub_qty = cleanNum(body.sub_qty) || 1;
    const total_stock = Math.max(0, Math.floor(p_qty * sub_qty));
    const batch_price = cleanNum(body.batch_price);
    const unit_price = Math.floor(batch_price / (total_stock || 1));

    const description = JSON.stringify({
      p_qty,
      p_unit: body.p_unit,
      s_unit: body.s_unit,
      sub_qty,
      batch_price,
      vendor: body.vendor,
    });

    const newItem = await prisma.supplyItem.create({
      data: {
        name,
        unit_price,
        current_stock: total_stock,
        alert_qty: cleanNum(body.alert_qty),
        owner_dept: String(body.owner_dept || '전사'),
        category: String(body.category || '일반'),
        description,
        image_url: body.image_url || null,
        is_published: false,
        is_active: true,
      },
    });
    return NextResponse.json(newItem);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard POST]', error);
    return NextResponse.json({ error: error?.message || '등록 실패' }, { status: 500 });
  }
}

/** [PATCH] 수정 / 게시 토글 / 폐기 / 복구 */
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();
    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });

    // [A-1] 폐기(보관함 이동)
    if (body.is_active === false) {
      let ext: any = {};
      try {
        ext = JSON.parse(existing.description || '{}');
      } catch {
        ext = {};
      }
      ext = {
        ...ext,
        disposal_date: body.disposal_date || new Date().toISOString(),
        disposal_reason: String(body.disposal_reason || '').trim() || '사유 미입력',
        disposer_dept: sessionDeptName(auth.user),
        disposer_name: auth.user.name || '관리자',
      };
      await prisma.supplyItem.update({
        where: { id },
        data: { is_active: false, is_published: false, description: JSON.stringify(ext) },
      });
      return NextResponse.json({ success: true, message: '폐기 완료' });
    }

    // [A-2] 아카이브 복구
    if (body.is_active === true && body.name === undefined && body.is_published === undefined) {
      const updated = await prisma.supplyItem.update({
        where: { id },
        data: { is_active: true },
      });
      return NextResponse.json({ success: true, message: '복구 완료', data: updated });
    }

    // [B] 게시 토글만
    if (typeof body.is_published === 'boolean' && body.name === undefined) {
      await prisma.supplyItem.update({
        where: { id },
        data: { is_published: body.is_published },
      });
      return NextResponse.json({ success: true });
    }

    // [C] 정보 수정
    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: '품목명이 필요합니다.' }, { status: 400 });
    }

    const description = JSON.stringify({
      p_qty: cleanNum(body.p_qty) || 1,
      p_unit: body.p_unit,
      s_unit: body.s_unit,
      sub_qty: cleanNum(body.sub_qty) || 1,
      batch_price: cleanNum(body.batch_price) || 0,
      vendor: body.vendor,
      note: body.note,
    });

    const updated = await prisma.supplyItem.update({
      where: { id },
      data: {
        name,
        unit_price: cleanNum(body.unit_price) || 0,
        current_stock: Math.max(0, cleanNum(body.current_stock) || 0),
        alert_qty: cleanNum(body.alert_qty) || 0,
        description,
        image_url: body.image_url ?? existing.image_url,
      },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard PATCH]', error);
    return NextResponse.json({ error: error?.message || '수정 실패' }, { status: 500 });
  }
}

/** [DELETE] 영구 삭제 — LV_1만 */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    assertLv1(auth);

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });

    await prisma.$transaction([
      prisma.supplyPurchase.deleteMany({ where: { item_id: id } }),
      prisma.supplyRequest.deleteMany({ where: { item_id: id } }),
      prisma.supplyItem.delete({ where: { id } }),
    ]);

    return NextResponse.json({ message: '완전히 삭제되었습니다.' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard DELETE]', error);
    return NextResponse.json({ error: '삭제 실패. 권한을 확인하세요.' }, { status: 500 });
  }
}
