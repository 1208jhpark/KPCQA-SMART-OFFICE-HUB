import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseKSTDateOnly } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept } from '@/utils/orgUnits';
import {
  authorizeMarketingApi,
  assertCanEditOwnerDept,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

function parseDistDate(raw: unknown) {
  if (!raw || typeof raw !== 'string') return new Date();
  const d = parseKSTDateOnly(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** 본인 지급 여부 — 이메일 우선, 레거시(이메일 없음)는 이름+부서 */
function isOwnDistribution(
  dist: { sender_email?: string | null; sender_name?: string | null; sender_dept?: string | null },
  user: { email?: string | null; name?: string | null; unit?: { unit_name?: string | null } | null }
) {
  const email = (user.email || '').trim().toLowerCase();
  if (dist.sender_email) {
    return dist.sender_email.trim().toLowerCase() === email;
  }
  // 과거 데이터: 이메일 미기록 → 이름+부서로만 보조 매칭
  const myDept = user.unit?.unit_name || '';
  return (
    !!dist.sender_name &&
    dist.sender_name === user.name &&
    !!dist.sender_dept &&
    dist.sender_dept === myDept
  );
}

export async function GET(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const senderEmail = searchParams.get('senderEmail') || searchParams.get('sender_email');
  const sender = searchParams.get('sender');
  const dept = searchParams.get('dept');
  const deptsRaw = searchParams.get('depts'); // 콤마 구분 — 본부+하위 센터 롤업
  const mine = searchParams.get('mine'); // '1' | 'true' → 로그인 사용자 본인만

  try {
    const whereClause: any = {};

    if (mine === '1' || mine === 'true' || senderEmail === 'me') {
      const email = (auth.user.email || '').trim();
      const myName = auth.user.name || '';
      const myDept = auth.user.unit?.unit_name || '';
      // 이메일 일치 OR (레거시: email null + 이름+부서)
      whereClause.OR = [
        { sender_email: { equals: email, mode: 'insensitive' } },
        {
          AND: [
            { OR: [{ sender_email: null }, { sender_email: '' }] },
            { sender_name: myName },
            { sender_dept: myDept },
          ],
        },
      ];
    } else {
      if (senderEmail) {
        whereClause.sender_email = { equals: senderEmail, mode: 'insensitive' };
      }
      if (sender) whereClause.sender_name = sender;
      const deptList = deptsRaw
        ? deptsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : dept
          ? [dept]
          : [];
      if (deptList.length === 1) whereClause.sender_dept = deptList[0];
      else if (deptList.length > 1) whereClause.sender_dept = { in: deptList };
    }

    const distributions = await prisma.marketingDistribution.findMany({
      where: whereClause,
      include: { item: true },
      // 신청 쌓인 순(최신 위). 동일 시각 대비 id는 FE에서 보조
      orderBy: [{ createdAt: 'desc' }, { dist_date: 'desc' }],
    });
    return NextResponse.json(distributions);
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const itemId = body.item_id;
    const qty = Number(body.qty) || 0;

    if (!itemId) return NextResponse.json({ error: '물품 ID가 필요합니다.' }, { status: 400 });
    if (qty <= 0) return NextResponse.json({ error: '지급 수량은 1 이상이어야 합니다.' }, { status: 400 });
    if (!body.client_name) return NextResponse.json({ error: '고객사명은 필수입니다.' }, { status: 400 });

    const newDist = await prisma.$transaction(async (tx) => {
      const item = await tx.marketingItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error('ITEM_NOT_FOUND');
      if (item.is_archived) throw new Error('ITEM_ARCHIVED');

      // Catalog FE와 동일: LV_1만 전체 지급. 마스터·TOTAL 편집은 지급 우회 불가
      const isPower = auth.permission.myRole === 'LV_1';
      const myCenter = auth.user.unit?.unit_name;
      const myHq = (auth.user.unit as any)?.parent?.unit_name as string | undefined;
      const topOrg = resolveTopOrgName(auth.unitsList);
      const allowed = canDistributeMarketingOwnerDept(item.owner_dept, {
        myUnitName: myCenter,
        myUnitId: auth.user.unit_id || (auth.user.unit as any)?.id,
        myHqName: myHq,
        topOrgName: topOrg,
        units: auth.unitsList,
        isPower,
      });
      if (!allowed) throw new Error('FORBIDDEN_DISTRIBUTE');

      const stockResult = await tx.marketingItem.updateMany({
        where: {
          id: itemId,
          current_stock: { gte: qty },
          is_archived: { not: true },
        },
        data: {
          current_stock: { decrement: qty },
        },
      });

      if (stockResult.count === 0) throw new Error('INSUFFICIENT_STOCK');

      const created = await tx.marketingDistribution.create({
        data: {
          item_id: itemId,
          client_id: body.client_id || null,
          client_name: body.client_name,
          client_dept: body.client_dept || '전사',
          qty,
          purpose: body.purpose || '',
          // 신원은 서버 세션 기준으로 고정 (클라이언트 spoof 방지)
          sender_name: auth.user.name,
          sender_dept: auth.user.unit?.unit_name || '미소속',
          sender_email: auth.user.email,
          dist_date: parseDistDate(body.dist_date),
        },
      });

      if (body.client_id && body.client_dept) {
        const client = await tx.marketingClient.findUnique({ where: { id: body.client_id } });
        if (client) {
          const currentDepts = Array.isArray(client.departments) ? (client.departments as any[]) : [];
          const existingDeptNames = currentDepts.map((d) => (typeof d === 'string' ? d : d.name));
          if (!existingDeptNames.includes(body.client_dept)) {
            await tx.marketingClient.update({
              where: { id: body.client_id },
              data: {
                departments: [...currentDepts, { name: body.client_dept, is_hidden: false }],
              },
            });
          }
        }
      }

      return created;
    });

    return NextResponse.json(newDist);
  } catch (error: any) {
    if (error?.message === 'ITEM_NOT_FOUND') {
      return NextResponse.json({ error: '물품을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (error?.message === 'ITEM_ARCHIVED') {
      return NextResponse.json({ error: '종료된 물품은 지급할 수 없습니다.' }, { status: 400 });
    }
    if (error?.message === 'INSUFFICIENT_STOCK') {
      return NextResponse.json(
        { error: '보유 재고가 부족합니다. (다른 사용자가 먼저 지급했을 수 있습니다.)' },
        { status: 409 }
      );
    }
    if (error?.message === 'FORBIDDEN_DISTRIBUTE') {
      return NextResponse.json(
        { error: '해당 물품에 대한 지급 권한이 없습니다.' },
        { status: 403 }
      );
    }
    console.error('🔥 [지급 처리 에러]:', error.message);
    return NextResponse.json({ error: '등록 및 재고 처리 실패' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await authorizeMarketingApi({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { id, client_name, client_dept, dist_date } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (client_name !== undefined) data.client_name = client_name;
    if (client_dept !== undefined) data.client_dept = client_dept;
    if (dist_date) {
      const d = parseKSTDateOnly(dist_date);
      if (!Number.isNaN(d.getTime())) data.dist_date = d;
    }

    const updated = await prisma.marketingDistribution.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    // 본인 건 철회 / 타인 건: LV_1·마스터만
    auth = await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

    await prisma.$transaction(async (tx) => {
      const dist = await tx.marketingDistribution.findUnique({
        where: { id },
        include: { item: true },
      });
      if (!dist) throw new Error('DIST_NOT_FOUND');

      const own = isOwnDistribution(dist, auth.user);
      const canCancelOthers =
        auth.permission.isMaster || auth.permission.myRole === 'LV_1';
      if (own) {
        // 본인 신청 철회: 메뉴 접근만으로 허용
      } else if (canCancelOthers) {
        assertCanEditOwnerDept(auth, dist.item?.owner_dept);
      } else {
        throw new Error('FORBIDDEN_CANCEL');
      }

      await tx.marketingDistribution.delete({ where: { id } });
      await tx.marketingItem.update({
        where: { id: dist.item_id },
        data: { current_stock: { increment: dist.qty } },
      });
    });

    return NextResponse.json({ message: '취소 및 재고 복구 완료' });
  } catch (error: any) {
    if (error?.message === 'DIST_NOT_FOUND') {
      return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (error?.message === 'FORBIDDEN_CANCEL') {
      return NextResponse.json(
        { error: '본인 신청만 철회할 수 있습니다. (타인 건은 LV_1·마스터만 가능합니다.)' },
        { status: 403 }
      );
    }
    if (error?.message === 'FORBIDDEN_EDIT') {
      return authErrorToResponse(error);
    }
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
