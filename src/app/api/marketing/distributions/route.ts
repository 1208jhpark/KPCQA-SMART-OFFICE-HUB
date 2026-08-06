import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { parseKSTDateOnly, getKSTYearMonth, getDistBusinessDate } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept, canApplyViaViewRoles, getChildUnitNames, isGlobalMgmtOrgMember } from '@/utils/orgUnits';
import {
  authorizeMarketingDistributionsRead,
  authorizeMarketingDistributionsApply,
  authorizeMarketingDistributionsManage,
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
    auth = await authorizeMarketingDistributionsRead();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const senderEmail = searchParams.get('senderEmail') || searchParams.get('sender_email');
  const sender = searchParams.get('sender');
  const dept = searchParams.get('dept');
  const deptsRaw = searchParams.get('depts'); // 콤마 구분 — 본부+하위 센터 롤업
  const ownerDept = searchParams.get('ownerDept') || searchParams.get('owner_dept');
  const ownerDeptsRaw = searchParams.get('ownerDepts') || searchParams.get('owner_depts');
  const mine = searchParams.get('mine'); // '1' | 'true' → 로그인 사용자 본인만
  const clientId = searchParams.get('clientId') || searchParams.get('client_id');
  const clientDept = searchParams.get('clientDept') || searchParams.get('client_dept');
  const clientName = searchParams.get('clientName') || searchParams.get('client_name');
  const yearRaw = searchParams.get('year');
  const yearFilter = yearRaw ? Number(yearRaw) : null;
  const summary = searchParams.get('summary');
  const statusFilter = searchParams.get('status');

  try {
    // 대시보드 (전사) TOP5 — 집계만 반환 (신청자·건별 상세 없음). 전원 조회 가능.
    if (summary === 'companyTop') {
      const rows = await prisma.marketingDistribution.findMany({
        where: { status: { not: 'REJECTED' } },
        select: {
          qty: true,
          dist_date: true,
          createdAt: true,
          client_name: true,
          item: { select: { name: true, unit_price: true } },
        },
      });

      type ItemAgg = { name: string; value: number };
      type ClientAgg = { name: string; value: number; amount: number };
      const byYear: Record<number, { topItems: ItemAgg[]; topClients: ClientAgg[] }> = {};

      const itemMaps: Record<number, Record<string, number>> = {};
      const clientMaps: Record<number, Record<string, { qty: number; amount: number }>> = {};

      for (const d of rows) {
        const ym = getKSTYearMonth(getDistBusinessDate(d) as Date | string);
        if (!ym) continue;
        const y = ym.year;
        const qty = Number(d.qty) || 0;
        const itemName = d.item?.name || '기타';
        const cName = String(d.client_name || '').trim() || '(미지정)';
        const price = Number(d.item?.unit_price) || 0;

        if (!itemMaps[y]) itemMaps[y] = {};
        itemMaps[y][itemName] = (itemMaps[y][itemName] || 0) + qty;

        if (!clientMaps[y]) clientMaps[y] = {};
        if (!clientMaps[y][cName]) clientMaps[y][cName] = { qty: 0, amount: 0 };
        clientMaps[y][cName].qty += qty;
        clientMaps[y][cName].amount += qty * price;
      }

      const years = Object.keys(itemMaps)
        .map(Number)
        .sort((a, b) => b - a);

      for (const y of years) {
        const topItems = Object.entries(itemMaps[y] || {})
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
        const topClients = Object.entries(clientMaps[y] || {})
          .map(([name, s]) => ({ name, value: s.qty, amount: s.amount }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
        byYear[y] = { topItems, topClients };
      }

      return NextResponse.json({ years, byYear });
    }

    const whereClause: any = {};

    if (clientId) whereClause.client_id = clientId;
    if (clientDept) whereClause.client_dept = clientDept;
    if (clientName) whereClause.client_name = clientName;
    if (statusFilter) whereClause.status = statusFilter;

    const ownerList = ownerDeptsRaw
      ? ownerDeptsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : ownerDept
        ? [ownerDept]
        : [];

    if (ownerList.length > 0) {
      // 물품소속 기준 — 권한 있는 범위만 허용
      const myDept = auth.user.unit?.unit_name || '';
      const myUnitId = auth.user.unit_id || (auth.user.unit as { id?: string } | null)?.id;
      const topOrg = resolveTopOrgName(auth.unitsList);
      const mgmt = String(
        (auth.systemConfig as { global_mgmt_dept?: string } | null)?.global_mgmt_dept || ''
      ).trim();
      const isLv1 = auth.permission.myRole === 'LV_1';
      const isMgmt = isGlobalMgmtOrgMember({
        myUnitName: myDept,
        myUnitId: myUnitId,
        globalMgmtDept: mgmt,
        units: auth.unitsList,
      });

      const allowedOwners = new Set<string>();
      if (isLv1 || auth.permission.isMaster) {
        ownerList.forEach((o) => allowedOwners.add(o));
      } else {
        if (myDept) {
          allowedOwners.add(myDept);
          getChildUnitNames(myDept, myUnitId, auth.unitsList).forEach((c) => allowedOwners.add(c));
        }
        if (isMgmt && topOrg) allowedOwners.add(topOrg);
      }

      const safeOwners = ownerList.filter((o) => allowedOwners.has(o));
      if (safeOwners.length === 0) {
        return NextResponse.json([]);
      }
      whereClause.item = {
        owner_dept: safeOwners.length === 1 ? safeOwners[0] : { in: safeOwners },
      };
    } else if (mine === '1' || mine === 'true' || senderEmail === 'me') {
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
    } else if (clientId) {
      // 고객사 이력(client-search): 팀 간 중복지급 확인용 — 전사 이력, 신청부서 스코프 없음
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

      const myDept = auth.user.unit?.unit_name || '';
      const myUnitId = auth.user.unit_id || (auth.user.unit as { id?: string } | null)?.id;
      const isLv1 = auth.permission.myRole === 'LV_1' || auth.permission.isMaster;
      const allowedDepts = new Set<string>();
      if (myDept) {
        allowedDepts.add(myDept);
        getChildUnitNames(myDept, myUnitId, auth.unitsList).forEach((c) => allowedDepts.add(c));
      }

      if (deptList.length > 0) {
        // 요청 depts는 허용 범위로 교집합 (LV_1/마스터는 요청값 그대로)
        const safeDepts = isLv1
          ? deptList
          : deptList.filter((d) => allowedDepts.has(d));
        if (safeDepts.length === 0) {
          return NextResponse.json([]);
        }
        whereClause.sender_dept =
          safeDepts.length === 1 ? safeDepts[0] : { in: safeDepts };
      } else if (!isLv1) {
        // 필터 없음 = 전사 조회 → LV_1만 허용, 그 외는 본인·직속 하위로 강제
        const scoped = Array.from(allowedDepts);
        if (scoped.length === 0) {
          return NextResponse.json([]);
        }
        whereClause.sender_dept = scoped.length === 1 ? scoped[0] : { in: scoped };
      }
      // LV_1 + depts 없음 → 전사(필터 없음)
    }

    let distributions = await prisma.marketingDistribution.findMany({
      where: whereClause,
      include: { item: true },
      // 신청 쌓인 순(최신 위). 동일 시각 대비 id는 FE에서 보조
      orderBy: [{ createdAt: 'desc' }, { dist_date: 'desc' }],
    });

    // KST 연도 필터 — 지급일자(dist_date) 우선
    if (yearFilter && Number.isFinite(yearFilter)) {
      distributions = distributions.filter((d) => {
        const ym = getKSTYearMonth(getDistBusinessDate(d) as Date | string);
        return ym?.year === yearFilter;
      });
    }

    // 고객사 이력: 신청자 PII 제거 (신청부서는 팀 간 공유용으로 유지)
    if (clientId) {
      return NextResponse.json(
        distributions.map((d) => {
          const { sender_name: _n, sender_email: _e, ...rest } = d as typeof d & {
            sender_name?: string | null;
            sender_email?: string | null;
          };
          return { ...rest, sender_name: null, sender_email: null };
        })
      );
    }

    return NextResponse.json(distributions);
  } catch (error) {
    return NextResponse.json({ error: '데이터 로드 실패' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingDistributionsApply();
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
      const allowed =
        canDistributeMarketingOwnerDept(item.owner_dept, {
          myUnitName: myCenter,
          myUnitId: auth.user.unit_id || (auth.user.unit as any)?.id,
          myHqName: myHq,
          topOrgName: topOrg,
          units: auth.unitsList,
          isPower,
        }) ||
        canApplyViaViewRoles(
          item as { view_role_ids?: unknown; view_allow_apply?: boolean | null },
          auth.user.roles
        );
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
          status:
            body.requires_approval === true || body.status === 'PENDING'
              ? 'PENDING'
              : 'CONFIRMED',
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
  let auth;
  try {
    auth = await authorizeMarketingDistributionsManage({ requireEditor: true });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const body = await req.json();
    const { id, client_name, client_dept, dist_date, action } = body;
    if (!id) return NextResponse.json({ error: 'ID가 없습니다.' }, { status: 400 });

    const existing = await prisma.marketingDistribution.findUnique({
      where: { id },
      include: { item: { select: { owner_dept: true } } },
    });
    if (!existing) return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });

    assertCanEditOwnerDept(auth, existing.item?.owner_dept);

    // GLOBAL_MGMT 등: Organization 풀 승인요청 처리
    if (action === 'approve' || action === 'reject') {
      if (existing.status !== 'PENDING') {
        return NextResponse.json({ error: '승인 대기 건만 처리할 수 있습니다.' }, { status: 400 });
      }

      if (action === 'approve') {
        const d = dist_date ? parseKSTDateOnly(dist_date) : new Date();
        const updated = await prisma.marketingDistribution.update({
          where: { id },
          data: {
            status: 'CONFIRMED',
            approved_at: new Date(),
            dist_date: Number.isNaN(d.getTime()) ? new Date() : d,
          },
        });
        return NextResponse.json(updated);
      }

      // reject: 이력 유지(REJECTED) + 재고 복구, 사유 필수
      const reason = String(body.reject_reason || body.reason || '').trim();
      if (!reason) {
        return NextResponse.json({ error: '반려 사유를 입력해 주세요.' }, { status: 400 });
      }
      const rejected = await prisma.$transaction(async (tx) => {
        const updated = await tx.marketingDistribution.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reject_reason: reason,
            rejected_at: new Date(),
          },
        });
        await tx.marketingItem.update({
          where: { id: existing.item_id },
          data: { current_stock: { increment: existing.qty } },
        });
        return updated;
      });
      return NextResponse.json(rejected);
    }

    const data: Record<string, unknown> = {};
    if (client_name !== undefined) data.client_name = client_name;
    if (client_dept !== undefined) data.client_dept = client_dept;
    if (dist_date) {
      const d = parseKSTDateOnly(dist_date);
      if (!Number.isNaN(d.getTime())) data.dist_date = d;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: '수정할 항목이 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.marketingDistribution.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'FORBIDDEN_EDIT') {
      return authErrorToResponse(error);
    }
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let auth;
  try {
    // 본인 건 철회 / 타인 건: LV_1·마스터만 — register·dept 접근
    auth = await authorizeMarketingDistributionsManage();
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
      // REJECTED는 반려 시 이미 재고 복구됨 — 중복 복구 방지
      if (dist.status !== 'REJECTED') {
        await tx.marketingItem.update({
          where: { id: dist.item_id },
          data: { current_stock: { increment: dist.qty } },
        });
      }
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
