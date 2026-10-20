'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import {
  getKSTYearMonth,
  getKSTNowYearMonth,
  getDistBusinessDate,
  getKSTDateString,
} from '@/utils/dateUtils';
import { getChildUnitNames, isGlobalMgmtOrgMember, resolveTopOrgName } from '@/utils/orgUnits';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import DeptSharedCalendar from '@/components/marketing/DeptSharedCalendar';

/** 나의 예약 현황 도넛 — 상태별 색 (취소 건 제외) */
const RESERVATION_STATUS_META = [
  { key: 'confirmed', name: '예약 확정', color: '#10b981' },
  { key: 'pending', name: '예약 대기', color: '#f59e0b' },
] as const;

const DEFAULT_GROUPWARE_SHORTCUT_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=8';
const GROUPWARE_SHORTCUT_STORAGE_KEY_PREFIX = 'mkt_groupware_shortcut_url:';
/**
 * 관리자 To-Do 판별·이동 대상:
 * `/marketing/distribution/dept` (카탈로그 catalog 아님)
 * — settings GLOBAL_MGMT ∩ 해당 메뉴 Edit 권한(Task Editor 또는 Edit Level)
 */
const DEPT_MENU_PATH = '/marketing/distribution/dept';
const CATALOG_HREF = '/marketing/distribution/catalog';
const DEPT_APPROVAL_HREF = '/marketing/distribution/dept';

function groupwareStorageKey(userKey: string) {
  return `${GROUPWARE_SHORTCUT_STORAGE_KEY_PREFIX}${String(userKey || 'anon').trim().toLowerCase()}`;
}

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
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
  /** 본인 부서+직속 하위 스코프 지급 이력 (KPI용) */
  const [distributions, setDistributions] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupwareShortcutUrl, setGroupwareShortcutUrl] = useState(DEFAULT_GROUPWARE_SHORTCUT_URL);
  /** GLOBAL_MGMT ∩ dept Edit 권한 → 관리자 To-Do 카드 */
  const [isAdminLounge, setIsAdminLounge] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [loungeLoading, setLoungeLoading] = useState(true);

  const { year: currentYear, month: currentMonth } = getKSTNowYearMonth();
  const displayName = String(currentUser?.name || '').trim() || '사용자';

  /** 나의 물품 예약 현황 — 연/월 필터 (기본: 올해 · 전체 월) */
  const [reservationYear, setReservationYear] = useState(currentYear);
  const [reservationMonth, setReservationMonth] = useState<number | 'ALL'>('ALL');

  useEffect(() => {
    const fetchData = async () => {
      setLoadError(null);
      setLoungeLoading(true);
      const ts = Date.now();
      try {
        const [meRes, uRes, cfgRes, ifRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`),
          fetch(`/api/admin/units?active=true&t=${ts}`),
          fetch(`/api/admin/config?t=${ts}`),
          fetch(`/api/admin/interface?t=${ts}`),
        ]);

        const failed: string[] = [];
        if (!meRes.ok) failed.push('사용자');
        if (!uRes.ok) failed.push('조직');

        const user = meRes.ok ? await meRes.json() : null;
        const loadedUnits = uRes.ok ? await uRes.json() : [];
        const sysCfg = cfgRes.ok ? await cfgRes.json() : null;
        const interfaces = ifRes.ok ? await ifRes.json() : [];
        setCurrentUser(user);

        const userKey = String(user?.email || user?.id || '').trim();
        if (userKey && typeof window !== 'undefined') {
          const stored = localStorage.getItem(groupwareStorageKey(userKey));
          if (stored?.trim()) setGroupwareShortcutUrl(stored.trim());
        }
        const gwUrl = String(user?.groupwareShortcutUrl || '').trim();
        if (gwUrl) {
          setGroupwareShortcutUrl(gwUrl);
          if (userKey && typeof window !== 'undefined') {
            localStorage.setItem(groupwareStorageKey(userKey), gwUrl);
          }
        }

        const myDept = user?.unit?.unit_name || '';
        const myUnitId = user?.dept_id || user?.unit_id || user?.unit?.id;
        const scopedDepts = new Set<string>();
        if (myDept) {
          scopedDepts.add(myDept);
          getChildUnitNames(myDept, myUnitId, loadedUnits).forEach((n) => scopedDepts.add(n));
        }
        const scopedList = Array.from(scopedDepts);

        // KPI용 — 본인 부서+직속 하위만
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

        // 관리자 카드: settings GLOBAL_MGMT + /marketing/distribution/dept Edit 권한
        const deptMenu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === DEPT_MENU_PATH)
          : null;
        const inMgmtTree = isGlobalMgmtOrgMember({
          myUnitName: myDept,
          myUnitId,
          globalMgmtDept: sysCfg?.global_mgmt_dept,
          units: loadedUnits,
        });
        const deptEdit = resolveInterfaceEditState(user, deptMenu || null);
        const adminMode = !!(inMgmtTree && deptEdit.isEditor);
        setIsAdminLounge(adminMode);

        if (adminMode) {
          const top = resolveTopOrgName(loadedUnits);
          if (top) {
            try {
              const qs = new URLSearchParams({
                ownerDept: top,
                status: 'PENDING',
                t: String(ts),
              });
              const pRes = await fetch(`/api/marketing/distributions?${qs}`);
              if (pRes.ok) {
                const list = await pRes.json();
                setPendingApprovalCount(Array.isArray(list) ? list.length : 0);
              } else {
                setPendingApprovalCount(0);
                failed.push('승인대기');
              }
            } catch {
              setPendingApprovalCount(0);
              failed.push('승인대기');
            }
          } else {
            setPendingApprovalCount(0);
          }
        } else {
          setPendingApprovalCount(0);
        }

        setLoungeLoading(false);

        if (failed.length > 0) {
          const status = [meRes, dRes].find((r) => r && !r.ok)?.status;
          setLoadError(
            status === 401
              ? '로그인 세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
          );
        }
      } catch (error) {
        console.error(error);
        setDistributions([]);
        setCurrentUser(null);
        setIsAdminLounge(false);
        setPendingApprovalCount(0);
        setLoungeLoading(false);
        setLoadError('네트워크 오류로 대시보드 데이터를 불러오지 못했습니다.');
      }
    };
    fetchData();
  }, []);

  /** 나의 최근 예약 내역 — 최근 3건 (취소 제외) */
  const myRecentReservations = useMemo(() => {
    return distributions
      .filter((d) => isMyDistribution(d, currentUser) && d.status !== 'REJECTED')
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      })
      .slice(0, 3)
      .map((d) => {
        const ymd = getKSTDateString(d.createdAt) || '';
        return {
          id: d.id,
          status: d.status === 'PENDING' ? 'pending' : 'confirmed',
          statusLabel: d.status === 'PENDING' ? '예약대기' : '예약확정',
          name: d.item?.name || '(삭제된 물품)',
          qty: Number(d.qty) || 0,
          unit: d.item?.unit || '개',
          dateLabel: ymd ? ymd.replace(/-/g, '.') : '-',
        };
      });
  }, [distributions, currentUser]);

  const reservationYears = useMemo(() => {
    const years = distributions
      .filter((d) => isMyDistribution(d, currentUser) && d.status !== 'REJECTED')
      .map((d) => getKSTYearMonth(d.createdAt || (getDistBusinessDate(d) as string))?.year)
      .filter((y): y is number => typeof y === 'number');
    const unique = Array.from(new Set(years)).sort((a, b) => b - a);
    if (!unique.includes(currentYear)) unique.unshift(currentYear);
    return unique;
  }, [distributions, currentUser, currentYear]);

  /** 나의 물품 예약 현황 — 예약확정 / 예약대기 (취소 제외), 연·월 필터 */
  const myReservationStatus = useMemo(() => {
    let confirmed = 0;
    let pending = 0;

    distributions.forEach((d) => {
      if (!isMyDistribution(d, currentUser)) return;
      if (d.status === 'REJECTED') return;
      const ym = getKSTYearMonth(d.createdAt || (getDistBusinessDate(d) as string));
      if (!ym || ym.year !== reservationYear) return;
      if (reservationMonth !== 'ALL' && ym.month !== reservationMonth) return;
      if (d.status === 'PENDING') pending += 1;
      else if (d.status === 'CONFIRMED') confirmed += 1;
    });

    const total = confirmed + pending;
    const slices = [
      { ...RESERVATION_STATUS_META[0], value: confirmed },
      { ...RESERVATION_STATUS_META[1], value: pending },
    ].filter((s) => s.value > 0);

    return { confirmed, pending, total, slices };
  }, [distributions, currentUser, reservationYear, reservationMonth]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-4 animate-fade-in">
      {/* 다크 헤더 밴드 — 문구 없이 배경만 */}
      <div className="bg-slate-900 h-16 md:h-20 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 w-56 h-56 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
      </div>

      <div className="max-w-[1600px] mx-auto px-6 md:px-8 -mt-6 space-y-3 relative z-10">

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

      {/* 2️⃣ KPI 요약 카드 — 하단 달력(2)·디테일(1)과 동일 3열 gap-3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
        {/* 1) 활동 라운지 / 관리자 To-Do */}
        <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm min-h-[220px] h-full flex flex-col justify-between">
          <div className="min-w-0 flex-1">
            {isAdminLounge ? (
              <>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none">
                  관리자 To-Do
                </p>
                <p className="text-[11px] font-normal text-slate-400 mt-1">처리 대기함</p>
                <div className="mt-3 space-y-1.5">
                  {loungeLoading ? (
                    <p className="text-[12px] font-normal text-slate-400">불러오는 중…</p>
                  ) : (
                    <>
                      <p className="text-[13px] font-normal text-[#333333] leading-snug">
                        <span className="font-medium text-[#222222]">{displayName}</span> 님,
                      </p>
                      <p className="text-[12px] font-normal text-slate-500 leading-snug">
                        현재 확인 및 확정 처리가 필요한 예약 대기 건이
                      </p>
                      <p
                        className="tabular-nums leading-none tracking-tight pt-1"
                        style={{ fontSize: 36, fontWeight: 700, color: '#f97316' }}
                      >
                        {pendingApprovalCount.toLocaleString()}
                        <span className="ml-1 align-baseline" style={{ fontSize: 18, fontWeight: 700 }}>
                          건
                        </span>
                      </p>
                      <p className="text-[12px] font-normal text-slate-500 leading-snug">있습니다.</p>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none">
                  나의 활동 라운지
                </p>
                <p className="text-[11px] font-normal text-slate-400 mt-1">
                  {currentYear}.{pad2(currentMonth)}
                </p>
                <div className="mt-3 space-y-2">
                  {loungeLoading ? (
                    <p className="text-[12px] font-normal text-slate-400">불러오는 중…</p>
                  ) : (
                    <>
                      <p className="text-[13px] font-normal text-[#333333] leading-relaxed">
                        <span className="font-medium text-[#222222]">{displayName}</span> 님,
                        <br />
                        하단 캘린더에 우리 부서의 출장/대외 행사 등 일정을 등록하고 공유해 보세요.
                      </p>
                      <p className="text-[12px] font-normal text-slate-500 leading-relaxed">
                        일정에 필요한 기념품은 미리 예약하실 수 있습니다.
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <Link
            href={isAdminLounge ? DEPT_APPROVAL_HREF : CATALOG_HREF}
            className={`mt-auto shrink-0 w-full h-10 rounded-xl text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
              isAdminLounge
                ? 'bg-orange-500 hover:bg-orange-600 shadow-sm'
                : 'bg-indigo-600 hover:bg-indigo-700 shadow-sm'
            }`}
          >
            {isAdminLounge ? '⚙️ 예약 승인/관리 바로가기' : '🛍️ 기념품 카탈로그 바로가기'}
          </Link>
        </div>

        {/* 2) 예약 현황 */}
        <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm min-h-[220px] h-full flex flex-col">
          <div className="shrink-0 space-y-0.5">
            <div className="flex items-start justify-between gap-2 min-h-5">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none truncate min-w-0 pt-0.5">
                나의 물품 예약 현황
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={reservationYear}
                  onChange={(e) => setReservationYear(Number(e.target.value))}
                  className="box-border h-5 max-h-5 min-h-0 text-[10px] font-medium bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-1.5 py-0 leading-5 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                  aria-label="연도"
                >
                  {reservationYears.map((year) => (
                    <option key={year} value={year}>
                      {year}년
                    </option>
                  ))}
                </select>
                <select
                  value={reservationMonth}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReservationMonth(v === 'ALL' ? 'ALL' : Number(v));
                  }}
                  className="box-border h-5 max-h-5 min-h-0 text-[10px] font-medium bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-1.5 py-0 leading-5 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                  aria-label="월"
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
            <p className="text-[9px] font-normal text-slate-400 leading-none h-4 flex items-center tabular-nums">
              {myReservationStatus.total.toLocaleString()}건
            </p>
          </div>

          <div className="flex-1 min-h-0 mt-2.5 flex items-end gap-3 pb-0">
            {myReservationStatus.total === 0 ? (
              <div className="flex-1 h-full flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-normal text-slate-400">해당 기간 예약 이력 없음</p>
              </div>
            ) : (
              <>
                <div className="relative w-[118px] h-[118px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={myReservationStatus.slices}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={34}
                        outerRadius={52}
                        paddingAngle={myReservationStatus.slices.length > 1 ? 2 : 0}
                        strokeWidth={0}
                      >
                        {myReservationStatus.slices.map((s) => (
                          <Cell key={s.key} fill={s.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload as { name: string; value: number };
                          return (
                            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-md">
                              <p className="text-[10px] font-medium text-slate-800">{row.name}</p>
                              <p className="text-[10px] font-normal text-indigo-600 mt-0.5">
                                {row.value.toLocaleString()}건
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[9px] font-normal text-slate-400 leading-none">합계</span>
                    <span className="text-sm font-medium text-slate-800 tabular-nums mt-0.5">
                      {myReservationStatus.total}
                    </span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5 self-center">
                  {RESERVATION_STATUS_META.map((meta) => {
                    const value =
                      meta.key === 'confirmed'
                        ? myReservationStatus.confirmed
                        : myReservationStatus.pending;
                    return (
                      <div key={meta.key} className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="text-[10px] font-normal text-slate-500 truncate flex-1">
                          {meta.name}
                        </span>
                        <span className="text-[11px] font-medium text-slate-800 tabular-nums shrink-0">
                          {value.toLocaleString()}건
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 3) 최근 예약 */}
        <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow min-h-[220px] h-full flex flex-col">
          <div className="shrink-0 space-y-0.5">
            <div className="flex items-start justify-between gap-2 min-h-5">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none truncate min-w-0 pt-0.5">
                나의 최근 예약 내역
              </p>
              <a
                href={groupwareShortcutUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="그룹웨어 기념품 지급 신청서 바로가기"
                className="shrink-0 inline-flex items-center h-5 px-2 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-medium hover:bg-amber-100 transition-colors leading-none"
              >
                그룹웨어 결재 상신 ↗
              </a>
            </div>
            <div className="h-4 flex items-center">
              <p className="text-[9px] font-normal text-slate-400 leading-none">
                최근 {myRecentReservations.length}건
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-0 mt-2.5 flex flex-col justify-end">
            {myRecentReservations.length === 0 ? (
              <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <p className="text-[10px] font-normal text-slate-400">최근 예약 내역 없음</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {myRecentReservations.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2 px-2.5 rounded-lg bg-slate-50 border border-slate-100 h-[44px] shrink-0"
                  >
                    <span
                      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                        row.status === 'pending'
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      }`}
                    >
                      {row.statusLabel}
                    </span>
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <p className="text-[11px] font-normal text-slate-800 truncate leading-tight min-w-0 flex-1" title={row.name}>
                        {row.name}
                        <span className="text-slate-500 font-normal ml-1">
                          ({row.qty.toLocaleString()}
                          {row.unit === 'EA' ? '개' : row.unit})
                        </span>
                      </p>
                      <p className="text-[10px] font-normal text-slate-400 tabular-nums shrink-0 whitespace-nowrap">
                        {row.dateLabel}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 소속 전용 공유 일정 (상위 본부·하위 센터 제외) */}
      <DeptSharedCalendar />

      </div>
    </div>
  );
}
