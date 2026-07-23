import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import {
  authorizeMarketingApi,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function normalizeClientName(name: unknown) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

type ItemQtyMap = Record<string, number>;
type DeptAgg = {
  monthItems: ItemQtyMap;
  yearItems: ItemQtyMap;
  monthTotal: number;
  yearTotal: number;
};

function itemsMapToList(map: ItemQtyMap) {
  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * GET /api/marketing/clients
 * - ?lite=1  → 마스터만 (Register 등). distributions/집계 없음
 * - 기본     → 마스터 + KST 집계(month/year/deptStats/lastDist). 전체 지급 배열 미포함
 */
export async function GET(req: Request) {
  try {
    await authorizeMarketingApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const lite = searchParams.get('lite') === '1';

    const clients = await prisma.marketingClient.findMany({
      orderBy: { name: 'asc' },
    });
    // 레거시: is_active=false 만 있던 건은 보관함으로 취급
    const shaped = clients.map((c) => ({
      ...c,
      is_archived: Boolean(c.is_archived) || c.is_active === false,
    }));

    if (lite) {
      return NextResponse.json(shaped);
    }

    const { year: kstYear, month: kstMonth } = getKSTNowYearMonth();
    const dists = await prisma.marketingDistribution.findMany({
      select: {
        id: true,
        client_id: true,
        client_dept: true,
        qty: true,
        createdAt: true,
        sender_name: true,
        sender_dept: true,
        item: { select: { name: true, unit_price: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    type ClientAgg = {
      distCount: number;
      monthTotal: number;
      yearTotal: number;
      yearDistCount: number;
      lastDist: {
        id: string;
        createdAt: Date;
        qty: number;
        client_dept: string | null;
        sender_name: string | null;
        sender_dept: string | null;
        item: { name: string | null } | null;
      } | null;
      depts: Map<string, DeptAgg>;
    };

    const byClient = new Map<string, ClientAgg>();

    for (const d of dists) {
      if (!d.client_id) continue;
      let agg = byClient.get(d.client_id);
      if (!agg) {
        agg = {
          distCount: 0,
          monthTotal: 0,
          yearTotal: 0,
          yearDistCount: 0,
          lastDist: null,
          depts: new Map(),
        };
        byClient.set(d.client_id, agg);
      }

      agg.distCount += 1;
      if (!agg.lastDist) {
        agg.lastDist = {
          id: d.id,
          createdAt: d.createdAt,
          qty: d.qty,
          client_dept: d.client_dept,
          sender_name: d.sender_name,
          sender_dept: d.sender_dept,
          item: d.item ? { name: d.item.name } : null,
        };
      }

      const ym = getKSTYearMonth(d.createdAt);
      if (!ym || ym.year !== kstYear) continue;

      const amount = d.qty * (d.item?.unit_price || 0);
      const itemName = d.item?.name || '기타';
      const deptKey = d.client_dept || '(미지정)';

      let dept = agg.depts.get(deptKey);
      if (!dept) {
        dept = { monthItems: {}, yearItems: {}, monthTotal: 0, yearTotal: 0 };
        agg.depts.set(deptKey, dept);
      }

      agg.yearTotal += amount;
      agg.yearDistCount += 1;
      dept.yearTotal += amount;
      dept.yearItems[itemName] = (dept.yearItems[itemName] || 0) + d.qty;

      if (ym.month === kstMonth) {
        agg.monthTotal += amount;
        dept.monthTotal += amount;
        dept.monthItems[itemName] = (dept.monthItems[itemName] || 0) + d.qty;
      }
    }

    const withSummary = shaped.map((c) => {
      const agg = byClient.get(c.id);
      const deptStats: Record<
        string,
        {
          monthTotal: number;
          yearTotal: number;
          monthItems: { name: string; qty: number }[];
          yearItems: { name: string; qty: number }[];
        }
      > = {};
      if (agg) {
        for (const [deptName, d] of agg.depts) {
          deptStats[deptName] = {
            monthTotal: d.monthTotal,
            yearTotal: d.yearTotal,
            monthItems: itemsMapToList(d.monthItems),
            yearItems: itemsMapToList(d.yearItems),
          };
        }
      }
      return {
        ...c,
        distCount: agg?.distCount ?? 0,
        monthTotal: agg?.monthTotal ?? 0,
        yearTotal: agg?.yearTotal ?? 0,
        yearDistCount: agg?.yearDistCount ?? 0,
        lastDist: agg?.lastDist ?? null,
        deptStats,
      };
    });

    return NextResponse.json(withSummary);
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
    const clientName = normalizeClientName(name);
    if (!clientName) {
      return NextResponse.json({ error: '고객사명은 필수입니다.' }, { status: 400 });
    }

    const dup = await prisma.marketingClient.findFirst({
      where: { name: { equals: clientName, mode: 'insensitive' } },
      select: { id: true, is_archived: true },
    });
    if (dup) {
      return NextResponse.json(
        {
          error: dup.is_archived
            ? `이미 보관함에 같은 고객사명("${clientName}")이 있습니다.`
            : `이미 등록된 고객사명입니다. ("${clientName}")`,
        },
        { status: 409 }
      );
    }

    const newClient = await prisma.marketingClient.create({
      data: {
        name: clientName,
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
    if (name !== undefined) {
      const clientName = normalizeClientName(name);
      if (!clientName) {
        return NextResponse.json({ error: '고객사명은 필수입니다.' }, { status: 400 });
      }
      const nameChanged =
        clientName.toLowerCase() !== normalizeClientName(clientBefore.name).toLowerCase();
      if (nameChanged) {
        const dup = await prisma.marketingClient.findFirst({
          where: {
            id: { not: id },
            name: { equals: clientName, mode: 'insensitive' },
          },
          select: { id: true, is_archived: true },
        });
        if (dup) {
          return NextResponse.json(
            {
              error: dup.is_archived
                ? `이미 보관함에 같은 고객사명("${clientName}")이 있습니다.`
                : `이미 등록된 고객사명입니다. ("${clientName}")`,
            },
            { status: 409 }
          );
        }
      }
      data.name = clientName;
    }
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

    if (typeof data.name === 'string' && clientBefore.name !== data.name) {
      await prisma.marketingDistribution.updateMany({
        where: { client_id: id },
        data: { client_name: data.name },
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
