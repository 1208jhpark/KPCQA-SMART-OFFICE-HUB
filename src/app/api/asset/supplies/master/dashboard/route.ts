import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeApi,
  authorizeAnyMenuPaths,
  assertSupplyOwnerDeptsEditable,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { createSupplyStockIn } from '@/lib/supply-stock-in';
import { getKSTDateString } from '@/utils/dateUtils';
import {
  parseSupplyOwnerDepts,
  resolveTopOrgName,
  serializeSupplyOwnerDepts,
} from '@/utils/orgUnits';
import { SEED_SUPPLY_ITEM_DEFAULTS } from '@/lib/supply-seed-items';

function resolveOwnerDepts(body: any, unitsList: any[] | undefined): string[] {
  if (Array.isArray(body?.owner_depts)) {
    return parseSupplyOwnerDepts(body.owner_depts);
  }
  if (body?.owner_dept !== undefined && body?.owner_dept !== null && body?.owner_dept !== '') {
    return parseSupplyOwnerDepts(body.owner_dept);
  }
  const top = resolveTopOrgName(unitsList);
  return top ? [top] : [];
}

export const dynamic = 'force-dynamic';

const MENU_PATH = '/asset/supplies/master/dashboard';

/** 마스터 Step 공통 Access — restock 등에서도 활성 물품 목록 조회 */
const MASTER_MENU_PATHS = [
  '/asset/supplies/master/dashboard',
  '/asset/supplies/master/requests',
  '/asset/supplies/master/restock',
  '/asset/supplies/master/purchase',
  '/asset/supplies/master/archive',
];

/** 대기 상태(영문·구 한글) — requests 메뉴 Access 없이 대시보드에서 집계 */
const PENDING_STATUSES = ['PENDING', '대기중', '대기'];

const cleanNum = (val: any) => Number(String(val ?? '').replace(/,/g, '')) || 0;

function sessionDeptName(user: any) {
  return user?.unit?.unit_name || '소속 부서 없음';
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

/** [GET] 활성 소모품 마스터 + 단위 코드 + 신청 대기 집계 */
export async function GET() {
  try {
    await authorizeAnyMenuPaths(MASTER_MENU_PATHS);

    const config = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
    let units: any[] = [];
    if (config?.unit_category_group) {
      const unitGroup = await prisma.masterGroup.findUnique({
        where: { id: config.unit_category_group },
        include: { codes: { where: { is_active: true }, orderBy: { sort_order: 'asc' } } },
      });
      if (unitGroup) units = unitGroup.codes;
    }

    const [items, pendingRows] = await Promise.all([
      prisma.supplyItem.findMany({
        where: { is_active: true },
        include: {
          purchases: { orderBy: { purchase_date: 'desc' }, take: 1 },
          _count: { select: { requests: true, purchases: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.supplyRequest.findMany({
        where: { status: { in: PENDING_STATUSES } },
        select: { item_id: true },
      }),
    ]);

    const pendingItemIds = Array.from(
      new Set(pendingRows.map((r) => r.item_id).filter(Boolean))
    );

    return NextResponse.json({
      units,
      items,
      pendingCount: pendingRows.length,
      pendingItemIds,
    });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard GET]', error);
    return NextResponse.json({ error: '대시보드 로드 실패' }, { status: 500 });
  }
}

/** [POST] 신규 품목 등록 / action=stock_in 입고(대시보드 Edit만으로 처리) */
export async function POST(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });
    const body = await req.json();

    if (body?.action === 'stock_in') {
      const result = await createSupplyStockIn(auth, body);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ success: true, data: result.data });
    }

    // 시드 누락분 복구: LV_1 전용 — 없으면 추가, 비활성만 재활성 (단위·비고·재고 보존)
    if (body?.action === 'restore-seeds') {
      if (auth.permission?.myRole !== 'LV_1') {
        return NextResponse.json(
          { error: '시드 항목 복구는 LV_1만 가능합니다.' },
          { status: 403 }
        );
      }

      let created = 0;
      let reactivated = 0;

      for (const seed of SEED_SUPPLY_ITEM_DEFAULTS) {
        const byId = await prisma.supplyItem.findUnique({ where: { id: seed.id } });
        const byName =
          byId ||
          (await prisma.supplyItem.findFirst({
            where: { name: seed.name },
            orderBy: { createdAt: 'asc' },
          }));

        if (!byName) {
          assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(seed.owner_dept));
          await prisma.supplyItem.create({
            data: {
              id: seed.id,
              name: seed.name,
              unit_price: 0,
              current_stock: seed.current_stock,
              alert_qty: seed.alert_qty,
              owner_dept: serializeSupplyOwnerDepts(parseSupplyOwnerDepts(seed.owner_dept)),
              category: seed.category,
              description: JSON.stringify({
                s_unit: seed.s_unit,
                note: seed.note,
                publish_note: seed.publish_note || '',
              }),
              image_url: null,
              is_published: false,
              is_active: true,
            },
          });
          created += 1;
          continue;
        }

        if (!byName.is_active) {
          assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(byName.owner_dept));
          await prisma.supplyItem.update({
            where: { id: byName.id },
            data: {
              is_active: true,
              description: stripDisposalMeta(byName.description),
            },
          });
          reactivated += 1;
        }
      }

      return NextResponse.json({
        success: true,
        message:
          created + reactivated === 0
            ? '복구할 시드 품목이 없습니다. (이미 모두 활성)'
            : `시드 품목 복구 완료 (신규 ${created}건, 재활성 ${reactivated}건)`,
        created,
        reactivated,
      });
    }

    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: '품목명이 필요합니다.' }, { status: 400 });
    }

    const ownerDepts = resolveOwnerDepts(body, auth.unitsList);
    if (!ownerDepts.length) {
      return NextResponse.json({ error: '물품소속(조직)을 1개 이상 선택해주세요.' }, { status: 400 });
    }
    assertSupplyOwnerDeptsEditable(auth, ownerDepts);
    const owner_dept = serializeSupplyOwnerDepts(ownerDepts);

    const p_qty = cleanNum(body.p_qty) || 1;
    const sub_qty = cleanNum(body.sub_qty) || 1;
    const stockFromPack = Math.max(0, Math.floor(p_qty * sub_qty));
    const current_stock = body.current_stock !== undefined
      ? Math.max(0, Math.floor(cleanNum(body.current_stock)))
      : stockFromPack;
    const batch_price = cleanNum(body.batch_price);
    const unit_price = Math.floor(batch_price / (current_stock || 1));

    const description = JSON.stringify({
      s_unit: body.s_unit,
      note: body.note || '',
      publish_note: String(body.publish_note ?? '').trim(),
    });

    const newItem = await prisma.supplyItem.create({
      data: {
        name,
        unit_price,
        current_stock,
        alert_qty: cleanNum(body.alert_qty),
        owner_dept,
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
      assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(existing.owner_dept));
      let ext: any = {};
      try {
        ext = JSON.parse(existing.description || '{}');
      } catch {
        ext = {};
      }
      ext = {
        ...ext,
        disposal_date: body.disposal_date || getKSTDateString(),
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
      assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(existing.owner_dept));
      const updated = await prisma.supplyItem.update({
        where: { id },
        data: {
          is_active: true,
          description: stripDisposalMeta(existing.description),
        },
      });
      return NextResponse.json({ success: true, message: '복구 완료', data: updated });
    }

    // [B] 게시 토글만 — create/update와 동일하게 물품소속 편집 스코프 검증
    if (typeof body.is_published === 'boolean' && body.name === undefined) {
      assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(existing.owner_dept));
      await prisma.supplyItem.update({
        where: { id },
        data: { is_published: body.is_published },
      });
      return NextResponse.json({ success: true });
    }

    // [C] 정보 수정 — 지급단위만 마스터에 보관 (입고단위는 입고 시 기록)
    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ error: '품목명이 필요합니다.' }, { status: 400 });
    }

    let prevExt: any = {};
    try {
      prevExt = JSON.parse(existing.description || '{}');
    } catch {
      prevExt = {};
    }

    const ownerDepts =
      body.owner_depts !== undefined || body.owner_dept !== undefined
        ? resolveOwnerDepts(body, auth.unitsList)
        : parseSupplyOwnerDepts(existing.owner_dept);
    if (!ownerDepts.length) {
      return NextResponse.json({ error: '물품소속(조직)을 1개 이상 선택해주세요.' }, { status: 400 });
    }
    assertSupplyOwnerDeptsEditable(auth, ownerDepts);
    const owner_dept = serializeSupplyOwnerDepts(ownerDepts);

    const description = JSON.stringify({
      ...prevExt,
      s_unit: body.s_unit || prevExt.s_unit,
      note: body.note !== undefined ? body.note : prevExt.note,
      publish_note:
        body.publish_note !== undefined
          ? String(body.publish_note ?? '').trim()
          : prevExt.publish_note || '',
      // 마스터에서 입고단위는 더 이상 관리하지 않음
      p_unit: undefined,
      p_qty: undefined,
      sub_qty: undefined,
      batch_price: undefined,
      vendor: undefined,
    });

    const updated = await prisma.supplyItem.update({
      where: { id },
      data: {
        name,
        unit_price: cleanNum(body.unit_price) || existing.unit_price || 0,
        // 현재고는 기본 미변경 — LV_1만 초기재고·강제 보정 허용
        ...(auth.permission?.myRole === 'LV_1' && body.current_stock !== undefined
          ? { current_stock: Math.max(0, Math.floor(cleanNum(body.current_stock))) }
          : {}),
        alert_qty: cleanNum(body.alert_qty) || 0,
        owner_dept,
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

/** [DELETE] Edit 권한 — 신청·입고 이력 0건일 때만 (잘못 등록 데이터 정리) */
export async function DELETE(req: Request) {
  try {
    const auth = await authorizeApi(MENU_PATH, { requireEditor: true });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.supplyItem.findUnique({
      where: { id },
      include: { _count: { select: { requests: true, purchases: true } } },
    });
    if (!existing) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });

    assertSupplyOwnerDeptsEditable(auth, parseSupplyOwnerDepts(existing.owner_dept));

    const usageCount = existing._count.requests + existing._count.purchases;
    if (usageCount > 0) {
      return NextResponse.json(
        {
          error: `신청·입고 이력이 ${usageCount}건 있어 삭제할 수 없습니다. 보관 처리만 가능합니다.`,
        },
        { status: 400 }
      );
    }

    await prisma.supplyItem.delete({ where: { id } });

    return NextResponse.json({ message: '삭제 완료' });
  } catch (error) {
    const authRes = authErrorToResponse(error);
    if (authRes.status !== 500) return authRes;
    console.error('[supplies/master/dashboard DELETE]', error);
    return NextResponse.json({ error: '삭제 실패. 권한을 확인하세요.' }, { status: 500 });
  }
}
