import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  authorizeMarketingApi,
  assertCanEditOwnerDept,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

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

export async function GET(req: Request) {
  try {
    await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const dept = searchParams.get('dept');
  try {
    const items = await prisma.marketingItem.findMany({
      where: dept && dept !== '전체' ? { owner_dept: dept } : {},
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: '로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingApi({ requireEditor: true });
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

    const newItem = await prisma.marketingItem.create({
      data: {
        owner_type: body.owner_type || 'CENTER',
        owner_dept: body.owner_dept,
        name: body.name,
        unit_price: Number(body.unit_price) || 0,
        current_stock: Number(body.current_stock) || 0,
        alert_qty: Number(body.alert_qty) || 0,
        description: body.description || '',
        image_url: body.image_url || '',
        unit: body.unit || 'EA',
        creator_name: auth.user.name || body.creator_name || null,
        creator_dept: auth.user.unit?.unit_name || body.creator_dept || null,
        creator_email: auth.user.email || null,
      },
    });
    return NextResponse.json(newItem);
  } catch (error) {
    return NextResponse.json({ error: '등록 실패' }, { status: 500 });
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
      unit_price,
      alert_qty,
      description,
      image_url,
      owner_dept,
      unit,
      is_archived,
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

    // current_stock 은 입고/지급 API로만 변경 — PATCH로 직접 수정 불가 (Catalog FE와 동일)
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
    if (unit_price !== undefined) data.unit_price = Number(unit_price) || 0;
    if (alert_qty !== undefined) data.alert_qty = Number(alert_qty) || 0;
    if (unit !== undefined) data.unit = unit;
    // creator_* 는 등록 시점 화석화 — PATCH로 덮어쓰지 않음

    // 종료: 버튼을 누른 현재 세션 사용자로 archived_by_* 갱신 (재종료 포함)
    if (is_archived === true && !existing.is_archived) {
      data.is_archived = true;
      data.archived_by_name = auth.user.name || null;
      data.archived_by_dept = auth.user.unit?.unit_name || null;
      data.archived_by_email = auth.user.email || null;
    } else if (is_archived === false) {
      // 복구: 종료 플래그만 해제 + 이전 종료처리자 기록 초기화 (다음 종료 시 혼동 방지)
      data.is_archived = false;
      data.archived_by_name = null;
      data.archived_by_dept = null;
      data.archived_by_email = null;
    } else if (is_archived !== undefined) {
      data.is_archived = is_archived;
    }

    const updatedItem = await prisma.marketingItem.update({
      where: { id },
      data,
    });
    return NextResponse.json(updatedItem);
  } catch (error: any) {
    return NextResponse.json({ error: '수정 실패', details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    // force=1: 종료(아카이브) 물품의 LV_1 완전 삭제 (지급·입고 포함)
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

    // 일반 삭제: 편집자 + owner_dept 스코프 / 지급 신청이 없을 때만 (입고는 함께 삭제)
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
      // 테스트 오입고 정리 — 입고 이력 cascade 삭제 후 물품 삭제
      await tx.marketingPurchase.deleteMany({ where: { item_id: id } });
      await tx.marketingItem.delete({ where: { id } });
    });
    return NextResponse.json({ message: '삭제 완료 (관련 입고 이력 포함)' });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
