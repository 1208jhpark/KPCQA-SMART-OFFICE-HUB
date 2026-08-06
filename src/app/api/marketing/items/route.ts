import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingItemsRead,
  authorizeMarketingItemsWrite,
  assertCanEditOwnerDept,
  authErrorToResponse,
} from '@/lib/server-auth-guard';
import { isGlobalMgmtOrgMember, canDistributeMarketingOwnerDept, resolveTopOrgName, canApplyViaViewRoles } from '@/utils/orgUnits';

export const dynamic = 'force-dynamic';

type MarketingAuth = Awaited<ReturnType<typeof authorizeMarketingItemsRead>>;

/** Prisma 클라이언트 미갱신 시에도 view 필드 접근 (schema에는 존재) */
type ItemViewFields = {
  view_role_ids?: unknown;
  view_allow_apply?: boolean | null;
};

/** Catalog FE와 동일 — 원본 약 500KB, data URL 문자 수 한도 */
const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128;

function assertImageUrlWithinLimit(imageUrl: unknown): string | null {
  if (imageUrl === undefined || imageUrl === null || imageUrl === '') return null;
  if (typeof imageUrl !== 'string') {
    return '이미지 형식이 올바르지 않습니다.';
  }
  if (imageUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
    return '이미지는 500KB 이하만 등록할 수 있습니다. 용량을 줄인 뒤 다시 시도해 주세요.';
  }
  return null;
}

function normalizeRoleIds(raw: unknown): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const r of arr) {
    const m = String(r ?? '').trim().match(/(\d+)/);
    if (m) out.push(`LV_${m[1]}`);
  }
  return Array.from(new Set(out));
}

function parseViewRoleIds(raw: unknown): string[] {
  return normalizeRoleIds(raw).filter((r) => ['LV_1', 'LV_2', 'LV_3'].includes(r));
}

function userRoleIds(user: { roles?: unknown }): string[] {
  return normalizeRoleIds(user?.roles);
}

function canSetItemViewRoles(auth: MarketingAuth) {
  if (auth.permission.myRole === 'LV_1' || auth.permission.isMaster) return true;
  return isGlobalMgmtOrgMember({
    myUnitName: auth.user.unit?.unit_name,
    myUnitId: auth.user.unit_id,
    globalMgmtDept: (auth.systemConfig as { global_mgmt_dept?: string } | null)?.global_mgmt_dept,
    units: auth.unitsList,
  });
}

/**
 * 열람 판정
 * - 신청가능 범위·본인 소속·GLOBAL_MGMT 계정 → 항상 노출
 * - Organization / GLOBAL_MGMT 지정 부서 소유: 기존 정책(미지정=타부서 숨김, 지정 LV만 열람)
 * - 그외 부서 소유: 예전처럼 타부서도 열람 가능(신청은 view_allow_apply·소속 범위로 제어)
 */
function canViewMarketingItem(
  item: { owner_dept?: string | null; view_role_ids?: unknown },
  auth: MarketingAuth
) {
  if (auth.permission.myRole === 'LV_1' || auth.permission.isMaster) return true;

  const myDept = auth.user.unit?.unit_name || '';
  const myHq = (auth.user.unit as { parent?: { unit_name?: string } } | null)?.parent?.unit_name;
  const topOrgName = resolveTopOrgName(auth.unitsList);
  const mgmtDept = String(
    (auth.systemConfig as { global_mgmt_dept?: string } | null)?.global_mgmt_dept || ''
  ).trim();

  // 신청 가능 범위(본인 소속·상위본부·전사 풀 등) → 항상 노출
  if (
    canDistributeMarketingOwnerDept(item.owner_dept, {
      myUnitName: myDept,
      myUnitId: auth.user.unit_id,
      myHqName: myHq,
      topOrgName,
      units: auth.unitsList,
      isPower: false,
    })
  ) {
    return true;
  }

  if (item.owner_dept && item.owner_dept === myDept) return true;
  if (
    isGlobalMgmtOrgMember({
      myUnitName: myDept,
      myUnitId: auth.user.unit_id,
      globalMgmtDept: mgmtDept,
      units: auth.unitsList,
    })
  ) {
    return true;
  }

  const owner = String(item.owner_dept || '').trim();
  const isGlobalMgmtAsset =
    (!!topOrgName && owner === topOrgName) || (!!mgmtDept && owner === mgmtDept);

  const required = parseViewRoleIds(item.view_role_ids);
  const myRoles = userRoleIds(auth.user);

  if (isGlobalMgmtAsset) {
    // GLOBAL_MGMT·최상위 풀: 미지정=타부서 숨김 / 지정 LV만 열람
    if (required.length === 0) return false;
    return myRoles.some((r) => required.includes(r));
  }

  // 그외 부서: 열람 개방 (신청 버튼은 FE checkDistributePermission)
  return true;
}

export async function GET(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingItemsRead();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const dept = searchParams.get('dept');
  /** 부서대장 등: 열람 LV 무시하고 전체 (이력 연결용) */
  const raw = searchParams.get('raw') === '1' || searchParams.get('raw') === 'true';

  try {
    const items = await prisma.marketingItem.findMany({
      where: dept && dept !== '전체' ? { owner_dept: dept } : {},
      orderBy: { createdAt: 'desc' },
    });
    const visible = raw
      ? items
      : items.filter((item) =>
          canViewMarketingItem(item as typeof item & ItemViewFields, auth)
        );
    return NextResponse.json(visible);
  } catch (error) {
    return NextResponse.json({ error: '로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingItemsWrite();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    try {
      assertCanEditOwnerDept(auth, body.owner_dept);
    } catch (e) {
      return authErrorToResponse(e);
    }

    const imageErr = assertImageUrlWithinLimit(body.image_url);
    if (imageErr) return NextResponse.json({ error: imageErr }, { status: 400 });

    let viewRoleIds: string[] = [];
    let viewAllowApply = false;
    const wantsViewRoles =
      body.view_role_ids !== undefined || body.view_allow_apply !== undefined;
    if (wantsViewRoles) {
      const parsed = parseViewRoleIds(body.view_role_ids);
      const allow = !!body.view_allow_apply && parsed.length > 0;
      // 빈 기본값([])만 온 경우는 일반 등록 — GLOBAL_MGMT 불필요
      const isMeaningful =
        parsed.length > 0 || !!body.view_allow_apply;
      if (isMeaningful && !canSetItemViewRoles(auth)) {
        return NextResponse.json(
          { error: '열람 레벨은 GLOBAL_MGMT 지정 부서(및 직속 하위)만 설정할 수 있습니다.' },
          { status: 403 }
        );
      }
      if (isMeaningful) {
        viewRoleIds = parsed;
        viewAllowApply = allow;
      }
    }

    const unitPrice = Math.floor(Number(body.unit_price) || 0);
    const initialStock = Math.floor(Number(body.current_stock) || 0);
    const extraCost = Math.floor(Number(body.extra_cost ?? body.extraCost ?? 0));
    if (unitPrice < 0 || extraCost < 0) {
      return NextResponse.json({ error: '단가/부대비용은 0 이상이어야 합니다.' }, { status: 400 });
    }
    if (initialStock < 0) {
      return NextResponse.json({ error: '초기수량은 0 이상이어야 합니다.' }, { status: 400 });
    }

    const newItem = await prisma.$transaction(async (tx) => {
      const item = await tx.marketingItem.create({
        data: {
          owner_type: body.owner_type || 'CENTER',
          owner_dept: body.owner_dept,
          name: body.name,
          unit_price: unitPrice,
          current_stock: initialStock,
          alert_qty: Number(body.alert_qty) || 0,
          description: body.description || '',
          image_url: body.image_url || '',
          unit: body.unit || 'EA',
          creator_name: auth.user.name || body.creator_name || null,
          creator_dept: auth.user.unit?.unit_name || body.creator_dept || null,
          creator_email: auth.user.email || null,
          // Prisma client 미갱신(EPERM) 대비 — schema에는 존재
          ...({
            view_role_ids: viewRoleIds,
            view_allow_apply: viewAllowApply,
          } as object),
        },
      });

      // 초기수량이 있으면 입고 장부에 동일 정책으로 기록 (순수단가×수량 + 부대비용)
      if (initialStock > 0) {
        await tx.marketingPurchase.create({
          data: {
            item_id: item.id,
            qty: initialStock,
            unit_price: unitPrice,
            total_price: unitPrice * initialStock + extraCost,
            old_vendor: body.vendor || body.old_vendor || '',
            note: JSON.stringify({
              text: '신규 기념품 등록 초기입고',
              extra_cost: extraCost,
            }),
            purchaser_name: auth.user.name || '관리자',
            purchaser_dept: auth.user.unit?.unit_name || '미소속',
            purchaser_email: auth.user.email || null,
            purchase_date: new Date(),
          },
        });
      }

      return item;
    });
    return NextResponse.json(newItem);
  } catch (error) {
    return NextResponse.json({ error: '등록 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingItemsWrite();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const {
      id,
      name,
      unit_price,
      alert_qty,
      description,
      image_url,
      owner_dept,
      unit,
      is_archived,
      view_role_ids,
      view_allow_apply,
    } = body;
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const existing = await prisma.marketingItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });

    try {
      assertCanEditOwnerDept(auth, existing.owner_dept);
      if (owner_dept !== undefined) assertCanEditOwnerDept(auth, owner_dept);
    } catch (e) {
      return authErrorToResponse(e);
    }

    if (body.current_stock !== undefined) {
      return NextResponse.json(
        { error: '재고 수량은 수정할 수 없습니다. 입고 또는 지급으로만 변경됩니다.' },
        { status: 400 }
      );
    }

    if (image_url !== undefined) {
      const imageErr = assertImageUrlWithinLimit(image_url);
      if (imageErr) return NextResponse.json({ error: imageErr }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (owner_dept !== undefined) data.owner_dept = owner_dept;
    if (description !== undefined) data.description = description;
    if (image_url !== undefined) data.image_url = image_url;
    if (alert_qty !== undefined) data.alert_qty = Number(alert_qty) || 0;

    const priceOrUnitChange =
      (unit_price !== undefined && Number(unit_price) !== Number(existing.unit_price)) ||
      (unit !== undefined && String(unit) !== String(existing.unit || 'EA'));
    if (priceOrUnitChange) {
      const distCount = await prisma.marketingDistribution.count({
        where: { item_id: id },
      });
      if (distCount > 0) {
        return NextResponse.json(
          {
            error:
              '지급 신청 이력이 있어 단가·단위를 변경할 수 없습니다. 변경이 필요하면 신규 물품으로 등록해 주세요.',
          },
          { status: 400 }
        );
      }
      if (unit_price !== undefined) data.unit_price = Number(unit_price) || 0;
      if (unit !== undefined) data.unit = unit;
    } else {
      if (unit_price !== undefined) data.unit_price = Number(unit_price) || 0;
      if (unit !== undefined) data.unit = unit;
    }

    if (view_role_ids !== undefined || view_allow_apply !== undefined) {
      const nextRoles =
        view_role_ids !== undefined
          ? parseViewRoleIds(view_role_ids)
          : parseViewRoleIds((existing as typeof existing & ItemViewFields).view_role_ids);
      const meaningfulChange =
        (view_role_ids !== undefined && nextRoles.length > 0) ||
        !!view_allow_apply ||
        (view_role_ids !== undefined &&
          parseViewRoleIds((existing as typeof existing & ItemViewFields).view_role_ids)
            .length > 0);

      if (meaningfulChange && !canSetItemViewRoles(auth)) {
        return NextResponse.json(
          { error: '열람 레벨은 GLOBAL_MGMT 지정 부서(및 직속 하위)만 설정할 수 있습니다.' },
          { status: 403 }
        );
      }

      if (canSetItemViewRoles(auth)) {
        if (view_role_ids !== undefined) data.view_role_ids = nextRoles;
        if (view_allow_apply !== undefined) {
          data.view_allow_apply = !!view_allow_apply && nextRoles.length > 0;
        } else if (view_role_ids !== undefined && nextRoles.length === 0) {
          data.view_allow_apply = false;
        }
      }
      // 비-GLOBAL_MGMT + 빈 기본값만 온 경우 → 열람 필드 무시하고 나머지 필드만 저장
    }

    if (is_archived === true && !existing.is_archived) {
      data.is_archived = true;
      data.archived_by_name = auth.user.name || null;
      data.archived_by_dept = auth.user.unit?.unit_name || null;
      data.archived_by_email = auth.user.email || null;
    } else if (is_archived === false) {
      data.is_archived = false;
      data.archived_by_name = null;
      data.archived_by_dept = null;
      data.archived_by_email = null;
    } else if (is_archived !== undefined) {
      data.is_archived = is_archived;
    }

    const updatedItem = await prisma.marketingItem.update({
      where: { id },
      data: data as Parameters<typeof prisma.marketingItem.update>[0]['data'],
    });
    return NextResponse.json(updatedItem);
  } catch (error: any) {
    return NextResponse.json({ error: '수정 실패', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingItemsWrite();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    const existing = await prisma.marketingItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });

    if (force) {
      if (auth.permission.myRole !== 'LV_1' && !auth.permission.isMaster) {
        return NextResponse.json(
          { error: '아카이브 영구 삭제는 최고 관리자(LV_1)만 가능합니다.' },
          { status: 403 }
        );
      }
      if (!existing.is_archived) {
        return NextResponse.json(
          { error: '영구 삭제는 종료(아카이브) 처리된 물품만 가능합니다. 먼저 종료 처리하세요.' },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.marketingDistribution.deleteMany({ where: { item_id: id } });
        await tx.marketingPurchase.deleteMany({ where: { item_id: id } });
        await tx.marketingItem.delete({ where: { id } });
      });
      return NextResponse.json({ message: '아카이브 영구 삭제 완료' });
    }

    try {
      assertCanEditOwnerDept(auth, existing.owner_dept);
    } catch (e) {
      return authErrorToResponse(e);
    }

    const distCount = await prisma.marketingDistribution.count({ where: { item_id: id } });
    if (distCount > 0) {
      return NextResponse.json(
        { error: '지급 신청 이력이 있어 삭제할 수 없습니다. 종료(마감) 처리를 사용하세요.' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.marketingPurchase.deleteMany({ where: { item_id: id } });
      await tx.marketingItem.delete({ where: { id } });
    });
    return NextResponse.json({ message: '삭제 완료 (관련 입고 이력 포함)' });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
