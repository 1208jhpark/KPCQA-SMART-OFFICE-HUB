'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { getKSTYearMonth, getKSTNowYearMonth, getDistBusinessDate } from '@/utils/dateUtils';
import { resolveTopOrgName, getChildUnitNames, canDistributeMarketingOwnerDept, canApplyViaViewRoles } from '@/utils/orgUnits';

const LoadingSkeleton = () => (
  <div className="w-full max-w-[1600px] mx-auto py-16 px-6 md:px-8 space-y-6 animate-pulse">
    <div className="w-72 h-10 bg-slate-200 rounded-lg mb-4" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="w-full h-48 bg-slate-200 rounded-[1.5rem]" />
      <div className="w-full h-48 bg-slate-200 rounded-[1.5rem]" />
      <div className="w-full h-48 bg-slate-200 rounded-[1.5rem]" />
    </div>
    <div className="w-full h-64 bg-slate-200 rounded-[1.5rem]" />
    <div className="w-full h-48 bg-slate-200 rounded-[1.5rem]" />
  </div>
);

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b'];

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** 본인 지급 — 이메일 우선, 레거시(이메일 없음)는 이름+부서 */
function isMyDistribution(
  d: { sender_email?: string | null; sender_name?: string | null; sender_dept?: string | null },
  user: { email?: string | null; name?: string | null; unit?: { unit_name?: string | null } } | null
) {
  if (!user) return false;
  if (d.sender_email) return emailsEqual(d.sender_email, user.email);
  const myDept = user.unit?.unit_name || '';
  return !!d.sender_name && d.sender_name === user.name && !!d.sender_dept && d.sender_dept === myDept;
}

export default function DashboardModule() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  /** 본인 부서+직속 하위 스코프 지급 이력 (KPI용) */
  const [distributions, setDistributions] = useState<any[]>([]);
  /** (전사) TOP5 집계 — 신청자/건별 없는 요약만 */
  const [companyRankingByYear, setCompanyRankingByYear] = useState<
    Record<number, { topItems: { name: string; value: number }[]; topClients: { name: string; value: number; amount: number }[] }>
  >({});
  const [companyRankingYears, setCompanyRankingYears] = useState<number[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 🚀 [수정 1] 하드코딩 없는 현재 연/월 추출 및 랭킹 기준 연도 상태(기본값: 올해)
  const { year: currentYear } = getKSTNowYearMonth();
  const [selectedRankingYear, setSelectedRankingYear] = useState<number>(currentYear);

// 🚀 [추가] 인기 물품 TOP 5 전용 연도 상태 (기본값: 올해)
const [selectedItemYear, setSelectedItemYear] = useState<number>(currentYear);

  /** 나의 지급 통계 — 연/월 ('ALL' = 연도 전체 월, 기본: 올해·전체) */
  const [myStatsYear, setMyStatsYear] = useState<number>(currentYear);
  const [myStatsMonth, setMyStatsMonth] = useState<number | 'ALL'>('ALL');
  /** 나의 고객사 TOP3 — 전체보기 펼침 */
  const [myClientStatsExpanded, setMyClientStatsExpanded] = useState(false);

  /** 부서 인기 지급 물품 — 독립 연/월 (기본: 올해 · 전체) */
  const [deptTopYear, setDeptTopYear] = useState<number>(currentYear);
  const [deptTopMonth, setDeptTopMonth] = useState<number | 'ALL'>('ALL');

  useEffect(() => {
    const fetchData = async () => {
      setLoadError(null);
      const ts = Date.now();
      try {
        // 1) 사용자·조직·물품(열람 필터 적용 — Register와 동일, raw 미사용)
        //    + (전사) TOP5 집계 요약(전원, PII 없음)
        const [iRes, meRes, uRes, rankRes] = await Promise.all([
          fetch(`/api/marketing/items?t=${ts}`),
          fetch(`/api/auth/me?t=${ts}`),
          fetch(`/api/admin/units?active=true&t=${ts}`),
          fetch(`/api/marketing/distributions?summary=companyTop&t=${ts}`),
        ]);

        const failed: string[] = [];
        if (!iRes.ok) failed.push('물품');
        if (!meRes.ok) failed.push('사용자');
        if (!uRes.ok) failed.push('조직');
        if (!rankRes.ok) failed.push('전사랭킹');

        const user = meRes.ok ? await meRes.json() : null;
        const loadedUnits = uRes.ok ? await uRes.json() : [];
        if (iRes.ok) setItems(await iRes.json());
        else setItems([]);
        setCurrentUser(user);
        setUnits(loadedUnits);

        if (rankRes.ok) {
          const rankJson = await rankRes.json();
          setCompanyRankingByYear(rankJson?.byYear || {});
          setCompanyRankingYears(Array.isArray(rankJson?.years) ? rankJson.years : []);
        } else {
          setCompanyRankingByYear({});
          setCompanyRankingYears([]);
        }

        const myDept = user?.unit?.unit_name || '';
        const myUnitId = user?.dept_id || user?.unit_id || user?.unit?.id;
        const scopedDepts = new Set<string>();
        if (myDept) {
          scopedDepts.add(myDept);
          getChildUnitNames(myDept, myUnitId, loadedUnits).forEach((n) => scopedDepts.add(n));
        }
        const scopedList = Array.from(scopedDepts);

        // 2) KPI용 — 본인 부서+직속 하위만
        let dRes: Response | null = null;
        if (scopedList.length > 0) {
          const distQ =
            scopedList.length > 1
              ? `depts=${encodeURIComponent(scopedList.join(','))}`
              : `dept=${encodeURIComponent(scopedList[0])}`;
          dRes = await fetch(`/api/marketing/distributions?${distQ}&t=${ts}`);
          if (dRes.ok) setDistributions(await dRes.json());
          else {
            setDistributions([]);
            failed.push('지급');
          }
        } else {
          setDistributions([]);
        }

        if (failed.length > 0) {
          const status = [iRes, meRes, dRes, rankRes].find((r) => r && !r.ok)?.status;
          setLoadError(
            status === 401
              ? '로그인 세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
          );
        }
      } catch (error) {
        console.error(error);
        setItems([]);
        setDistributions([]);
        setCompanyRankingByYear({});
        setCompanyRankingYears([]);
        setCurrentUser(null);
        setLoadError('네트워크 오류로 대시보드 데이터를 불러오지 못했습니다.');
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const topOrgName = useMemo(() => resolveTopOrgName(units), [units]);

  const isLv1 = useMemo(() => {
    const roles = currentUser?.roles;
    if (!roles) return false;
    const arr = Array.isArray(roles) ? roles : [roles];
    return arr.some((r) => {
      const m = String(r ?? '').trim().match(/(\d+)/);
      return (m ? `LV_${m[1]}` : String(r)) === 'LV_1';
    });
  }, [currentUser]);

  // 활성(미종료) 품목
  const activeItems = useMemo(() => items.filter((i) => !i.is_archived), [items]);

  /** Catalog 「신청가능보기」와 동일 */
  const checkDistributePermission = (item: {
    owner_dept?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  }) => {
    if (!currentUser) return false;
    if (
      canDistributeMarketingOwnerDept(item.owner_dept, {
        myUnitName: currentUser.unit?.unit_name,
        myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
        myHqName: currentUser.unit?.parent?.unit_name,
        topOrgName,
        units,
        isPower: isLv1,
      })
    ) {
      return true;
    }
    return canApplyViaViewRoles(item, currentUser.roles);
  };

  const applicableItems = useMemo(() => {
    /** 신청루트(Register)와 동일 — units sort_order = Org → HQ → Center */
    const deptOrder = new Map<string, number>();
    units.forEach((u: { unit_name?: string | null }, idx: number) => {
      const name = u?.unit_name?.trim();
      if (name && !deptOrder.has(name)) deptOrder.set(name, idx);
    });
    return activeItems
      .filter((item) => checkDistributePermission(item))
      .sort((a, b) => {
        const ai = deptOrder.has(a.owner_dept) ? (deptOrder.get(a.owner_dept) as number) : Number.MAX_SAFE_INTEGER;
        const bi = deptOrder.has(b.owner_dept) ? (deptOrder.get(b.owner_dept) as number) : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      });
  }, [activeItems, currentUser, topOrgName, units, isLv1]);

  /** 부서 인기 지급 물품 TOP5 — 독립 연·월 + 부서(본인·직속하위) 스코프 */
  const deptTopItems = useMemo(() => {
    const myDept = currentUser?.unit?.unit_name || '';
    const myUnitId = currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id;
    const scopedDepts = new Set<string>();
    if (myDept) {
      scopedDepts.add(myDept);
      getChildUnitNames(myDept, myUnitId, units).forEach((n) => scopedDepts.add(n));
    }

    const map: Record<string, number> = {};
    distributions.forEach((d) => {
      if (d.status === 'REJECTED') return;
      if (!myDept || !scopedDepts.has(String(d.sender_dept || ''))) return;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      if (!ym || ym.year !== deptTopYear) return;
      if (deptTopMonth !== 'ALL' && ym.month !== deptTopMonth) return;
      const name = d.item?.name || '(삭제된 물품)';
      map[name] = (map[name] || 0) + (Number(d.qty) || 0);
    });

    return Object.entries(map)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [distributions, currentUser, units, deptTopYear, deptTopMonth]);

  /** 나의 지급 통계: 본인 vs 부서(본인 소속 + 직속 하위) */
  const myDistStats = useMemo(() => {
    const myDept = currentUser?.unit?.unit_name || '';
    const myUnitId = currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id;
    const scopedDepts = new Set<string>();
    if (myDept) {
      scopedDepts.add(myDept);
      getChildUnitNames(myDept, myUnitId, units).forEach((n) => scopedDepts.add(n));
    }

    let myAmount = 0;
    let myQty = 0;
    let deptAmount = 0;
    let deptQty = 0;

    distributions.forEach((d) => {
      if (d.status === 'REJECTED') return;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      if (!ym || ym.year !== myStatsYear) return;
      if (myStatsMonth !== 'ALL' && ym.month !== myStatsMonth) return;
      const amount = (Number(d.item?.unit_price) || 0) * (Number(d.qty) || 0);
      const qty = Number(d.qty) || 0;
      const inDept = myDept && scopedDepts.has(String(d.sender_dept || ''));
      if (inDept) {
        deptAmount += amount;
        deptQty += qty;
      }
      if (isMyDistribution(d, currentUser)) {
        myAmount += amount;
        myQty += qty;
      }
    });

    const amountPct = deptAmount > 0 ? Math.round((myAmount / deptAmount) * 1000) / 10 : 0;
    const qtyPct = deptQty > 0 ? Math.round((myQty / deptQty) * 1000) / 10 : 0;

    return { myAmount, myQty, deptAmount, deptQty, amountPct, qtyPct, myDept };
  }, [distributions, currentUser, units, myStatsYear, myStatsMonth]);

  const myStatsPeriodLabel =
    myStatsMonth === 'ALL' ? `${myStatsYear}년 전체` : `${myStatsYear}년 ${myStatsMonth}월`;

  /** 나의 지급 대장 × 연·월 — 고객사별 지급 수량 통계 */
  const myClientStats = useMemo(() => {
    const map: Record<string, { qty: number; amount: number }> = {};
    distributions.forEach((d) => {
      if (d.status === 'REJECTED') return;
      if (!isMyDistribution(d, currentUser)) return;
      const ym = getKSTYearMonth(getDistBusinessDate(d) as string);
      if (!ym || ym.year !== myStatsYear) return;
      if (myStatsMonth !== 'ALL' && ym.month !== myStatsMonth) return;
      const name = String(d.client_name || '').trim() || '(미지정)';
      if (!map[name]) map[name] = { qty: 0, amount: 0 };
      map[name].qty += Number(d.qty) || 0;
      map[name].amount += (Number(d.item?.unit_price) || 0) * (Number(d.qty) || 0);
    });
    const totalQty = Object.values(map).reduce((acc, cur) => acc + cur.qty, 0);
    return Object.entries(map)
      .map(([name, s]) => ({
        name,
        qty: s.qty,
        amount: s.amount,
        pct: totalQty > 0 ? Math.round((s.qty / totalQty) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.qty - a.qty || b.amount - a.amount || a.name.localeCompare(b.name, 'ko'));
  }, [distributions, currentUser, myStatsYear, myStatsMonth]);


// (전사) 인기 물품 TOP 5 — 서버 집계 요약
const topItemsData = useMemo(() => {
  return companyRankingByYear[selectedItemYear]?.topItems || [];
}, [companyRankingByYear, selectedItemYear]);

const availableYears = useMemo(() => {
  const years = [
    ...distributions.map((d) => getKSTYearMonth(getDistBusinessDate(d) as string)?.year),
    ...companyRankingYears,
  ].filter((y): y is number => typeof y === 'number');
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => b - a);
  if (!uniqueYears.includes(currentYear)) uniqueYears.unshift(currentYear);
  return uniqueYears;
}, [distributions, companyRankingYears, currentYear]);

// (전사) 최다 지급 고객사 TOP 5 — 서버 집계 요약 (막대 = 1위 대비)
const topClientsData = useMemo(() => {
  const clients = companyRankingByYear[selectedRankingYear]?.topClients || [];
  const topValue = Number(clients[0]?.value) || 0;
  return clients.map((c) => ({
    ...c,
    barPct: topValue > 0 ? Math.min(100, (Number(c.value) / topValue) * 100) : 0,
  }));
}, [companyRankingByYear, selectedRankingYear]);


  if (loading) return <LoadingSkeleton />;


  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-8 animate-fade-in">
      {/* 설문 허브와 동일 — 다크 헤더 밴드 + 문구 */}
      <div className="bg-slate-900 pt-6 pb-20 px-6 md:px-8 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="max-w-[1600px] mx-auto relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-indigo-400 font-black tracking-widest text-[10px] uppercase mb-1.5 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
              Marketing Command
            </p>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              마케팅 통합 대시보드
            </h1>
            <p className="text-slate-400 mt-1.5 text-xs font-medium max-w-xl leading-relaxed">
              마케팅 물품 지급 현황 및 고객사 랭킹 모니터링
            </p>
          </div>
          <span className="self-start md:self-auto bg-white/10 text-slate-300 font-bold px-3 py-1.5 rounded-xl text-[10px] border border-white/10 backdrop-blur-sm shrink-0">
            Current Analysis: {currentYear} YEAR (KST)
          </span>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 md:px-8 -mt-12 space-y-4 relative z-10">

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4 shadow-sm">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700"
          >
            새로고침
          </button>
        </div>
      )}

      {/* 2️⃣ KPI 요약 카드 — 동일 높이 + 하단 액션 라인 정렬 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col h-[248px]">
          <div className="flex items-start justify-between gap-2 flex-wrap shrink-0 h-[40px]">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                부서 인기 지급 물품
              </p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">TOP 5</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={deptTopYear}
                onChange={(e) => setDeptTopYear(Number(e.target.value))}
                className="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-1.5 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
              <select
                value={deptTopMonth}
                onChange={(e) => {
                  const v = e.target.value;
                  setDeptTopMonth(v === 'ALL' ? 'ALL' : Number(v));
                }}
                className="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-1.5 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
              >
                <option value="ALL">전체</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-0 mt-2.5">
            {deptTopItems.length === 0 ? (
              <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-bold text-slate-400">해당 기간 부서 지급 없음</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={deptTopItems.map((item, idx) => ({
                    ...item,
                    rank: idx + 1,
                    shortName:
                      item.name.length > 5 ? `${item.name.slice(0, 4)}…` : item.name,
                    fill: COLORS[idx % COLORS.length],
                  }))}
                  margin={{ top: 8, right: 4, left: -18, bottom: 2 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                    interval={0}
                    height={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as {
                        name: string;
                        qty: number;
                        rank: number;
                      };
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                          <p className="text-[10px] font-black text-slate-800">
                            {row.rank}. {row.name}
                          </p>
                          <p className="text-[10px] font-bold text-indigo-600 mt-0.5">
                            {row.qty.toLocaleString()}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="qty" radius={[6, 6, 2, 2]} maxBarSize={36}>
                    {deptTopItems.map((_, idx) => (
                      <Cell key={`dept-bar-${idx}`} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col h-[248px]">
          <div className="flex items-start justify-between gap-2 shrink-0 h-[40px]">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                나의 고객사 지급 수량 TOP 3
              </p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">{myStatsPeriodLabel}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-black text-indigo-600 leading-none">
                {myDistStats.myQty.toLocaleString()}
              </p>
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                {myClientStats.length.toLocaleString()}개 고객사
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-0 mt-2.5 flex flex-col">
            {myClientStats.length === 0 ? (
              <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-bold text-slate-400">해당 기간 지급 이력 없음</p>
              </div>
            ) : (
              <div
                className={`flex flex-col gap-1 flex-1 min-h-0 ${
                  myClientStatsExpanded ? 'overflow-y-auto pr-0.5' : 'justify-start'
                }`}
              >
                {(myClientStatsExpanded
                  ? myClientStats
                  : [0, 1, 2].map((i) => myClientStats[i] ?? null)
                ).map((row, idx) =>
                  row ? (
                    <div
                      key={row.name}
                      className="flex items-center gap-2 px-2 rounded-lg bg-slate-50 border border-slate-100 h-[36px] shrink-0"
                    >
                      <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black text-slate-800 truncate leading-tight" title={row.name}>
                          {row.name}
                        </p>
                        <div className="mt-0.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width: `${Math.min(100, row.pct)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0 leading-none">
                        <p className="text-[11px] font-black text-indigo-600">{row.qty.toLocaleString()}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{row.pct}%</p>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={`empty-client-${idx}`}
                      className="flex items-center justify-center px-2 rounded-lg bg-white border border-dashed border-slate-200 h-[36px] shrink-0"
                    >
                      <span className="text-[10px] font-bold text-slate-300">순위 없음</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 h-[32px] mt-2.5">
            {myClientStats.length > 3 ? (
              <button
                type="button"
                onClick={() => setMyClientStatsExpanded((v) => !v)}
                className="w-full h-full rounded-lg bg-indigo-50 text-indigo-600 text-[10px] font-black hover:bg-indigo-100 border border-indigo-100 transition-colors"
              >
                {myClientStatsExpanded
                  ? '접기'
                  : `전체보기 (+${myClientStats.length - 3})`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="bg-white p-5 rounded-[1.5rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col h-[248px]">
          <div className="flex items-center justify-between gap-2 flex-wrap shrink-0 h-[40px]">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              나의 지급 기여도
            </p>
            <div className="flex items-center gap-1.5">
              <select
                value={myStatsYear}
                onChange={(e) => {
                  setMyStatsYear(Number(e.target.value));
                  setMyClientStatsExpanded(false);
                }}
                className="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-1.5 py-1 outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
              <select
                value={myStatsMonth}
                onChange={(e) => {
                  const v = e.target.value;
                  setMyStatsMonth(v === 'ALL' ? 'ALL' : Number(v));
                  setMyClientStatsExpanded(false);
                }}
                className="text-[10px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-1.5 py-1 outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer"
              >
                <option value="ALL">전체</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center space-y-2 min-h-0 mt-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-500 shrink-0">금액</span>
              <p className="text-right text-[12px] font-black text-emerald-600 leading-snug">
                {myDistStats.myAmount.toLocaleString()}원
                <span className="text-[10px] font-bold text-emerald-500/80 ml-0.5">
                  ({myDistStats.amountPct}%)
                </span>
                <span className="text-slate-300 font-bold mx-1">/</span>
                <span className="text-slate-600">
                  {myDistStats.deptAmount.toLocaleString()}원
                </span>
              </p>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-500 shrink-0">수량</span>
              <p className="text-right text-[12px] font-black text-indigo-600 leading-snug">
                {myDistStats.myQty.toLocaleString()}
                <span className="text-[10px] font-bold text-indigo-500/80 ml-0.5">
                  ({myDistStats.qtyPct}%)
                </span>
                <span className="text-slate-300 font-bold mx-1">/</span>
                <span className="text-slate-600">
                  {myDistStats.deptQty.toLocaleString()}
                </span>
              </p>
            </div>
            <p className="text-[9px] font-bold text-slate-400 text-right">
              본인(부서 대비 %) / 부서
              {myDistStats.myDept ? ` · ${myDistStats.myDept}` : ''}
            </p>
          </div>

          <div className="shrink-0 h-[32px] mt-2.5 flex items-center gap-2">
            <Link
              href="/marketing/distribution/register"
              className="flex-1 h-full flex items-center justify-center rounded-lg bg-blue-50 text-blue-700 text-[10px] font-black hover:bg-blue-100 transition-colors"
            >
              나의 지급 대장 →
            </Link>
            <Link
              href="/marketing/distribution/dept"
              className="flex-1 h-full flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200 hover:text-slate-700 transition-colors"
            >
              부서 지급 대장 →
            </Link>
          </div>
        </div>
      </div>

      {/* 3️⃣ 메인 데이터 영역 (1:1:1) — (전사) TOP5는 전원 표시, 집계 API 사용 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 w-full items-stretch">
        
       {/* [왼쪽] 인기 지급 물품 TOP 5 (고정 5슬롯 적용 + 랭킹 뱃지 컬러 매칭) */}
       <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col w-full h-full min-h-0">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><span>🏆</span> (전사) 인기 지급 물품 TOP 5</h3>
            <select 
              value={selectedItemYear} 
              onChange={(e) => setSelectedItemYear(Number(e.target.value))}
              className="text-[11px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer shadow-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </div>
          <div className="h-[100px] w-full shrink-0 mb-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={topItemsData.length ? topItemsData : [{ name: '없음', value: 1 }]} innerRadius={28} outerRadius={46} paddingAngle={5} dataKey="value">
                  {(topItemsData.length ? topItemsData : [{ name: '없음', value: 1 }]).map((_, i) => (
                    <Cell key={i} fill={topItemsData.length ? COLORS[i % COLORS.length] : '#f1f5f9'} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any, name: any) => [`${Number(val).toLocaleString()}`, `${name}`]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* 고정 5슬롯 렌더링 */}
          <div className="flex flex-col gap-1 flex-1">
            {[0, 1, 2, 3, 4].map((index) => {
              const item = topItemsData[index];
              if (item) {
                // 🚀 차트와 동일한 인덱스 컬러 추출
                const itemColor = COLORS[index % COLORS.length]; 
                
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-50 border border-transparent h-[34px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span 
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-sm shrink-0"
                        style={{ backgroundColor: itemColor }}
                      >
                        {index + 1}
                      </span>
                      <span className="text-[11px] font-bold text-slate-700 truncate">{item.name}</span>
                    </div>
                    <span className="text-[11px] font-black text-indigo-600 shrink-0">{item.value.toLocaleString()}</span>
                  </div>
                );
              }
              return (
                <div key={`empty-${index}`} className="flex items-center justify-center px-2.5 py-1.5 rounded-xl bg-white border border-dashed border-slate-200 h-[34px]">
                  <span className="text-[10px] font-bold text-slate-300">순위 없음</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* [중앙] 물품 최다 수령 고객사 Ranking (고정 5슬롯 적용) */}
        <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col w-full h-full min-h-0">
          <div className="flex justify-between items-center mb-2 shrink-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <span>🏢</span> (전사) 최다 지급 고객사 TOP 5
            </h3>
            <select 
              value={selectedRankingYear} 
              onChange={(e) => setSelectedRankingYear(Number(e.target.value))}
              className="text-[11px] font-bold bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer shadow-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          </div>
          {/* 고정 5슬롯 — 행 사이 여백 균등 분배 */}
          <div className="flex flex-col flex-1 min-h-0 justify-between">
            {[0, 1, 2, 3, 4].map((index) => {
              const client = topClientsData[index];
              if (client) {
                return (
                  <div
                    key={client.name}
                    className="flex items-center gap-2 px-2 rounded-lg bg-slate-50 border border-slate-100 h-[36px] shrink-0"
                  >
                    <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] font-black text-slate-800 truncate leading-tight"
                        title={client.name}
                      >
                        {client.name}
                      </p>
                      <div className="mt-0.5 h-1 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${client.barPct}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] font-black text-indigo-600 shrink-0 tabular-nums">
                      {client.value.toLocaleString()}
                    </p>
                  </div>
                );
              }
              return (
                <div
                  key={`empty-${index}`}
                  className="flex items-center justify-center px-2 rounded-lg bg-white border border-dashed border-slate-200 h-[36px] shrink-0"
                >
                  <span className="text-[10px] font-bold text-slate-300">순위 없음</span>
                </div>
              );
            })}
          </div>

          <Link
            href="/marketing/distribution/client-search"
            className="mt-2 shrink-0 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100 hover:bg-emerald-100/80 hover:border-emerald-200 transition-colors group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm shrink-0">🏢</span>
              <div className="min-w-0">
                <p className="text-[11px] font-black text-emerald-800 truncate">고객사 통합 관리</p>
                <p className="text-[9px] font-bold text-emerald-600/70 truncate">전체 고객사 관리 · 수령 이력 조회</p>
              </div>
            </div>
            <span className="text-emerald-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0 text-sm font-black">→</span>
          </Link>
        </div>

{/* [오른쪽] 신청가능보기 + 카탈로그 바로가기 */}
<div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col w-full h-full min-h-0">
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <span>🎁</span> 나의 신청가능 품목 보기
            </h3>
            <div className="flex items-center gap-1.5">
              {applicableItems.some(
                (i) => Number(i.alert_qty) > 0 && Number(i.current_stock) <= Number(i.alert_qty)
              ) && (
                <span className="text-[9px] font-black bg-red-100 text-red-600 px-1.5 py-0.5 rounded-md border border-red-200">
                  재고확보 포함
                </span>
              )}
              <span className="text-[10px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md border border-indigo-100">
                {applicableItems.length}종
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto max-h-[248px] pr-0.5 space-y-1">
            {applicableItems.length === 0 ? (
              <div className="h-full min-h-[80px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                <p className="text-[11px] font-bold text-slate-400">신청 가능한 기념품이 없습니다.</p>
              </div>
            ) : (
              applicableItems.map((item) => {
                const stock = Number(item.current_stock) || 0;
                const canApply = stock > 0;
                const needRestock =
                  Number(item.alert_qty) > 0 && stock <= Number(item.alert_qty);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-xl border transition-colors ${
                      needRestock
                        ? 'bg-red-50 border-red-200 hover:border-red-300 hover:bg-red-50/80'
                        : 'bg-slate-50 border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p
                          className={`text-[11px] font-black truncate ${
                            needRestock ? 'text-red-800' : 'text-slate-800'
                          }`}
                          title={item.name}
                        >
                          {item.name}
                        </p>
                        {needRestock && (
                          <span className="shrink-0 text-[8px] font-black uppercase tracking-tight px-1.5 py-0.5 rounded bg-red-600 text-white">
                            재고확보
                          </span>
                        )}
                      </div>
                      <p className={`text-[9px] font-bold truncate ${needRestock ? 'text-red-400' : 'text-slate-400'}`}>
                        {item.owner_dept || '-'}
                        {needRestock ? ` · 기준 ${item.alert_qty}${item.unit || 'EA'} 이하` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-mono font-black tabular-nums px-1.5 py-0.5 rounded-md ${
                        stock <= 0
                          ? 'bg-red-100 text-red-600 border border-red-200'
                          : needRestock
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                      title={needRestock ? '재고 확보 필요' : '현재 재고'}
                    >
                      {stock}
                      <span className="text-[8px] font-bold ml-0.5">{item.unit || 'EA'}</span>
                    </span>
                    <button
                      type="button"
                      disabled={!canApply}
                      onClick={() =>
                        router.push(`/marketing/distribution/register?itemId=${item.id}`)
                      }
                      className={`shrink-0 px-2 py-1.5 rounded-lg text-[9px] font-black whitespace-nowrap transition-colors ${
                        canApply
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {canApply ? '지급신청하기' : '품절'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <Link
            href="/marketing/distribution/catalog"
            className="mt-2 shrink-0 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-100 hover:bg-indigo-100/80 hover:border-indigo-200 transition-colors group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm shrink-0">🎁</span>
              <div className="min-w-0">
                <p className="text-[11px] font-black text-indigo-800 truncate">기념품 조회 및 신청</p>
                <p className="text-[9px] font-bold text-indigo-600/70 truncate">카탈로그 · 재고 · 신규 등록</p>
              </div>
            </div>
            <span className="text-indigo-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0 text-sm font-black">→</span>
          </Link>
        </div>

      </div>

      </div>
    </div>
  );
}
