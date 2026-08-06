import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  getKSTNowYearMonth,
  getKSTYearMonth,
  getKSTYearRange,
  getDistBusinessDate,
} from '@/utils/dateUtils';
import {
  authorizeMarketingClientsRead,
  authorizeMarketingClientsWrite,
  authorizeMarketingClientsCreate,
  authErrorToResponse,
} from '@/lib/server-auth-guard';

export const dynamic = 'force-dynamic';

function normalizeClientName(name: unknown) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeDeptName(name: unknown) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/** 부서 배열에서 중복 이름(대소문자·공백 무시) 반환 — 없으면 null */
function findDuplicateDeptName(departments: unknown): string | null {
  if (!Array.isArray(departments)) return null;
  const seen = new Set<string>();
  for (const d of departments) {
    const deptName = normalizeDeptName(typeof d === 'string' ? d : (d as { name?: unknown })?.name);
    if (!deptName) continue;
    const key = deptName.toLowerCase();
    if (seen.has(key)) return deptName;
    seen.add(key);
  }
  return null;
}

type ItemQtyMap = Record<string, number>;
type DeptAgg = {
  monthItems: ItemQtyMap;
  yearItems: ItemQtyMap;
  monthTotal: number;
  yearTotal: number;
  monthQty: number;
  yearQty: number;
};
type DeptStatsMap = Record<
  string,
  {
    monthTotal: number;
    yearTotal: number;
    monthQty: number;
    yearQty: number;
    monthItems: { name: string; qty: number }[];
    yearItems: { name: string; qty: number }[];
  }
>;

function itemsMapToList(map: ItemQtyMap) {
  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function emptyDeptAgg(): DeptAgg {
  return { monthItems: {}, yearItems: {}, monthTotal: 0, yearTotal: 0, monthQty: 0, yearQty: 0 };
}

function deptMapToStats(depts: Map<string, DeptAgg>): DeptStatsMap {
  const deptStats: DeptStatsMap = {};
  for (const [deptName, d] of depts) {
    deptStats[deptName] = {
      monthTotal: d.monthTotal,
      yearTotal: d.yearTotal,
      monthQty: d.monthQty,
      yearQty: d.yearQty,
      monthItems: itemsMapToList(d.monthItems),
      yearItems: itemsMapToList(d.yearItems),
    };
  }
  return deptStats;
}

/**
 * GET /api/marketing/clients
 * - ?lite=1                 → 마스터만 (Register 등). 보관함 제외
 * - ?deptStatsClientId=id   → 해당 고객사 부서별 올해 확정 집계만 (펼침 시)
 * - 기본                    → 마스터 + 회사 단위 올해 합계 + distCount (deptStats 없음)
 *   · Edit 없으면 보관(archived) 미포함 — 보관함 탭과 동일
 */
export async function GET(req: Request) {
  let auth;
  try {
    const { searchParams } = new URL(req.url);
    const lite = searchParams.get('lite') === '1';
    auth = await authorizeMarketingClientsRead({ forRegisterLite: lite });
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const lite = searchParams.get('lite') === '1';
    const deptStatsClientId = String(searchParams.get('deptStatsClientId') || '').trim();
    // lite(지급신청)·열람만: 보관함 제외. Edit만 보관 포함
    const canSeeArchived = !lite && !!auth.permission?.isEditor;

    // ── 펼침: 한 고객사 부서 집계만 ───────────────────────────────
    if (deptStatsClientId) {
      const target = await prisma.marketingClient.findUnique({
        where: { id: deptStatsClientId },
        select: { id: true, is_archived: true, is_active: true },
      });
      if (!target) {
        return NextResponse.json({ error: '고객사 미존재' }, { status: 404 });
      }
      const targetArchived = Boolean(target.is_archived) || target.is_active === false;
      if (targetArchived && !canSeeArchived) {
        return NextResponse.json({ error: '보관된 고객사는 열람할 수 없습니다.' }, { status: 403 });
      }

      const { year: kstYear, month: kstMonth } = getKSTNowYearMonth();
      const { start: yearStart, end: yearEnd } = getKSTYearRange(kstYear);
      const dists = await prisma.marketingDistribution.findMany({
        where: {
          client_id: deptStatsClientId,
          status: { notIn: ['PENDING', 'REJECTED'] },
          dist_date: { gte: yearStart, lt: yearEnd },
        },
        select: {
          client_dept: true,
          qty: true,
          dist_date: true,
          createdAt: true,
          item: { select: { name: true, unit_price: true } },
        },
      });

      const depts = new Map<string, DeptAgg>();
      for (const d of dists) {
        const ym = getKSTYearMonth(getDistBusinessDate(d) as Date | string);
        if (!ym || ym.year !== kstYear) continue;
        const deptKey = d.client_dept || '(미지정)';
        let dept = depts.get(deptKey);
        if (!dept) {
          dept = emptyDeptAgg();
          depts.set(deptKey, dept);
        }
        const qty = Number(d.qty) || 0;
        const amount = qty * (d.item?.unit_price || 0);
        const itemName = d.item?.name || '기타';
        dept.yearTotal += amount;
        dept.yearQty += qty;
        dept.yearItems[itemName] = (dept.yearItems[itemName] || 0) + qty;
        if (ym.month === kstMonth) {
          dept.monthTotal += amount;
          dept.monthQty += qty;
          dept.monthItems[itemName] = (dept.monthItems[itemName] || 0) + qty;
        }
      }

      return NextResponse.json({
        clientId: deptStatsClientId,
        year: kstYear,
        deptStats: deptMapToStats(depts),
      });
    }

    const clients = await prisma.marketingClient.findMany({
      // lite(지급신청 선택용): 이름순 / 대장: 최신 등록이 위
      orderBy: lite
        ? [{ name: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    // 레거시: is_active=false 만 있던 건은 보관함으로 취급
    const shaped = clients
      .map((c) => ({
        ...c,
        is_archived: Boolean(c.is_archived) || c.is_active === false,
      }))
      .filter((c) => canSeeArchived || !c.is_archived);

    if (lite) {
      return NextResponse.json(shaped);
    }

    const { year: kstYear, month: kstMonth } = getKSTNowYearMonth();
    const { start: yearStart, end: yearEnd } = getKSTYearRange(kstYear);

    /**
     * 목록: 회사 단위 합계만 (deptStats 제외 → 펼침 시 지연 로딩).
     * distCount는 groupBy로 전체 건수만 집계.
     */
    const [dists, distCountRows] = await Promise.all([
      prisma.marketingDistribution.findMany({
        where: {
          client_id: { not: null },
          status: { notIn: ['PENDING', 'REJECTED'] },
          dist_date: { gte: yearStart, lt: yearEnd },
        },
        select: {
          client_id: true,
          qty: true,
          dist_date: true,
          createdAt: true,
          item: { select: { unit_price: true } },
        },
      }),
      prisma.marketingDistribution.groupBy({
        by: ['client_id'],
        _count: { _all: true },
      }),
    ]);

    const distCountByClient = new Map<string, number>();
    for (const row of distCountRows) {
      if (row.client_id) distCountByClient.set(row.client_id, row._count._all);
    }

    type ClientAgg = {
      monthTotal: number;
      yearTotal: number;
      monthQty: number;
      yearQty: number;
      yearDistCount: number;
    };
    const byClient = new Map<string, ClientAgg>();

    for (const d of dists) {
      if (!d.client_id) continue;
      let agg = byClient.get(d.client_id);
      if (!agg) {
        agg = { monthTotal: 0, yearTotal: 0, monthQty: 0, yearQty: 0, yearDistCount: 0 };
        byClient.set(d.client_id, agg);
      }

      const ym = getKSTYearMonth(getDistBusinessDate(d) as Date | string);
      if (!ym || ym.year !== kstYear) continue;

      const qty = Number(d.qty) || 0;
      const amount = qty * (d.item?.unit_price || 0);
      agg.yearTotal += amount;
      agg.yearQty += qty;
      agg.yearDistCount += 1;
      if (ym.month === kstMonth) {
        agg.monthTotal += amount;
        agg.monthQty += qty;
      }
    }

    const withSummary = shaped.map((c) => {
      const agg = byClient.get(c.id);
      return {
        ...c,
        distCount: distCountByClient.get(c.id) ?? 0,
        monthTotal: agg?.monthTotal ?? 0,
        yearTotal: agg?.yearTotal ?? 0,
        monthQty: agg?.monthQty ?? 0,
        yearQty: agg?.yearQty ?? 0,
        yearDistCount: agg?.yearDistCount ?? 0,
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
    // 신규 등록: client-search 메뉴 접근자 전원 (편집자 불필요 — FE +신규등록과 동일)
    auth = await authorizeMarketingClientsCreate();
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
    auth = await authorizeMarketingClientsWrite();
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
    if (departments !== undefined) {
      const dupDept = findDuplicateDeptName(departments);
      if (dupDept) {
        return NextResponse.json(
          { error: `부서명이 중복됩니다. ("${dupDept}")` },
          { status: 409 }
        );
      }
      data.departments = departments;
    }

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
 * 허용: LV_1만. 보관은 PATCH is_archived
 */
export async function DELETE(req: Request) {
  let auth;
  try {
    auth = await authorizeMarketingClientsCreate();
  } catch (e) {
    return authErrorToResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID 누락' }, { status: 400 });

  const existing = await prisma.marketingClient.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: '고객사 미존재' }, { status: 404 });

  if (auth.permission.myRole !== 'LV_1') {
    return NextResponse.json(
      { error: '영구 삭제는 최고 관리자(LV_1)만 가능합니다.' },
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
