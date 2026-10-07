import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizeAdminApi, authErrorToResponse } from '@/lib/server-auth-guard';
import {
  buildPageViewReportRows,
  normalizePagePath,
  seoulYmd,
  type InterfaceMenuRow,
} from '@/lib/page-view-stats';

export const dynamic = 'force-dynamic';

function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e || '');
  return (
    msg === 'UNAUTHORIZED' ||
    msg === 'UNAUTHORIZED_EXPIRED' ||
    msg === 'USER_NOT_FOUND' ||
    msg === 'FORBIDDEN_ADMIN' ||
    msg.startsWith('FORBIDDEN')
  );
}

/** LV_1 — 연/월 페이지 접속 집계 */
export async function GET(req: Request) {
  try {
    await authorizeAdminApi();
  } catch (e) {
    return authErrorToResponse(e);
  }

  try {
    const { searchParams } = new URL(req.url);
    const now = seoulYmd();
    const year = Number(searchParams.get('year') || now.year);
    const monthRaw = searchParams.get('month'); // 'all' | '1'..'12'
    const dayRaw = searchParams.get('day'); // 'all' | '1'..'31'
    const monthAll = !monthRaw || monthRaw === 'all' || monthRaw === '0';
    const dayAll = !dayRaw || dayRaw === 'all' || dayRaw === '0';
    const month = monthAll ? null : Number(monthRaw);
    // 월 전체일 때는 일 필터 무시(전체)
    const day = monthAll || dayAll ? null : Number(dayRaw);

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: '유효하지 않은 연도입니다.' }, { status: 400 });
    }
    if (month != null && (!Number.isFinite(month) || month < 1 || month > 12)) {
      return NextResponse.json({ error: '유효하지 않은 월입니다.' }, { status: 400 });
    }
    if (day != null) {
      const dim = new Date(year, month!, 0).getDate();
      if (!Number.isFinite(day) || day < 1 || day > dim) {
        return NextResponse.json({ error: '유효하지 않은 일입니다.' }, { status: 400 });
      }
    }

    const dayWhere = {
      year,
      ...(month != null ? { month } : {}),
      ...(day != null ? { day } : {}),
    };

    let hitRows: { path: string; hits: number }[] = [];
    let visitorRows: { path: string; userId: string }[] = [];
    let statsError: string | null = null;

    // 집계 테이블이 없거나 Prisma 클라이언트가 옛 버전이면 경로 카탈로그만이라도 반환
    try {
      if (!prisma.pageViewDaily || !prisma.pageViewVisitorDaily) {
        throw new Error(
          'Prisma 클라이언트에 PageView 모델이 없습니다. 서버 중지 후 npx prisma generate 를 실행하세요.'
        );
      }
      const [hits, visitors] = await Promise.all([
        prisma.pageViewDaily.findMany({
          where: dayWhere,
          select: { path: true, hits: true },
        }),
        prisma.pageViewVisitorDaily.findMany({
          where: dayWhere,
          select: { path: true, userId: true },
        }),
      ]);
      hitRows = hits;
      visitorRows = visitors;
    } catch (statErr) {
      console.error('[page-views] stats query failed', statErr);
      statsError =
        statErr instanceof Error
          ? statErr.message
          : '접속 집계 테이블 조회 실패 (migrate deploy / prisma generate 확인)';
    }

    const menus = await prisma.interfaceConfig.findMany({
      select: {
        id: true,
        path: true,
        name: true,
        level: true,
        parent_id: true,
        sort_order: true,
        icon: true,
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    const hitMap = new Map<string, number>();
    for (const r of hitRows) {
      const p = normalizePagePath(r.path);
      if (!p) continue;
      hitMap.set(p, (hitMap.get(p) || 0) + Number(r.hits || 0));
    }

    const userSets = new Map<string, Set<string>>();
    for (const r of visitorRows) {
      const p = normalizePagePath(r.path);
      if (!p || !r.userId) continue;
      if (!userSets.has(p)) userSets.set(p, new Set());
      userSets.get(p)!.add(r.userId);
    }
    const userMap = new Map<string, number>();
    for (const [p, set] of userSets) {
      userMap.set(p, set.size);
    }

    const menuRows: InterfaceMenuRow[] = menus.map((m) => ({
      id: m.id,
      path: m.path,
      name: m.name,
      level: m.level,
      parent_id: m.parent_id,
      sort_order: m.sort_order,
      icon: m.icon,
    }));

    const rows = buildPageViewReportRows({ menus: menuRows, hitMap, userMap });
    const totalHits = rows.reduce((s, r) => s + r.hits, 0);
    const totalUsersApprox = new Set(visitorRows.map((r) => r.userId).filter(Boolean)).size;

    let years = [now.year];
    try {
      if (prisma.pageViewDaily) {
        const yearGroups = await prisma.pageViewDaily.groupBy({
          by: ['year'],
          _count: { _all: true },
          orderBy: { year: 'desc' },
        });
        years = Array.from(
          new Set([now.year, ...yearGroups.map((g) => g.year)].filter((y) => y >= 2000))
        ).sort((a, b) => b - a);
      }
    } catch {
      /* keep default years */
    }

    return NextResponse.json({
      year,
      month: monthAll ? 'all' : month,
      day: day == null ? 'all' : day,
      years,
      totalHits,
      totalUsers: totalUsersApprox,
      rows,
      warning: statsError,
    });
  } catch (e) {
    if (isAuthError(e)) return authErrorToResponse(e);
    console.error('[page-views] GET error', e);
    const message = e instanceof Error ? e.message : '페이지 접속 집계 조회 중 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
