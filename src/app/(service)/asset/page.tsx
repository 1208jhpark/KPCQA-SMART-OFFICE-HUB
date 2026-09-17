'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { checkMenuPermission } from '@/lib/permission-utils';
import { resolveEntryHref } from '@/lib/resolve-entry-href';

type HubDomainKey = 'supplies' | 'it' | 'businesscard' | 'production' | 'other';

type L2Menu = {
  id: string;
  name: string;
  path: string;
  description?: string | null;
  page_description?: string | null;
  icon?: string | null;
  sort_order?: number;
  is_visible?: boolean;
  is_active?: boolean;
  level?: number;
  parent_id?: string | null;
};

const LoadingSkeleton = () => (
  <div className="w-full max-w-[1600px] mx-auto py-16 px-4 space-y-6 animate-pulse">
    <div className="w-64 h-10 bg-slate-200 rounded-lg mb-12" />
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
      <div className="w-full h-72 bg-slate-200 rounded-[1.75rem]" />
      <div className="w-full h-72 bg-slate-200 rounded-[1.75rem]" />
      <div className="w-full h-72 bg-slate-200 rounded-[1.75rem]" />
      <div className="w-full h-72 bg-slate-200 rounded-[1.75rem]" />
    </div>
  </div>
);

function resolveDomainKey(path: string): HubDomainKey {
  const p = String(path || '').toLowerCase();
  if (p.includes('/asset/supplies')) return 'supplies';
  if (p.includes('/asset/it')) return 'it';
  if (p.includes('/asset/businesscard')) return 'businesscard';
  if (p.includes('/asset/production')) return 'production';
  return 'other';
}

/** adminLink 경로에 Access가 있는지 InterfaceConfig 기준 판별 */
function canAccessAdminPath(
  adminPath: string,
  user: any,
  menus: any[],
  units: any[]
): boolean {
  if (!user || !adminPath || !menus.length) return false;
  const target = String(adminPath).replace(/\/$/, '').toLowerCase();
  const matched = menus
    .filter((m: any) => {
      const mp = String(m.path || '')
        .replace(/\/$/, '')
        .toLowerCase();
      if (!mp || mp === '/home') return false;
      return target === mp || target.startsWith(mp + '/');
    })
    .sort(
      (a: any, b: any) =>
        String(b.path || '').length - String(a.path || '').length
    )[0];
  if (!matched) return false;
  return checkMenuPermission(user, matched, menus, units).hasAccess;
}

/** path별 테마·링크만 유지. 명칭·아이콘·설명은 Interface 스탭2에서 로드 */
const DOMAIN_META: Record<
  HubDomainKey,
  {
    titleEn: string;
    theme: 'amber' | 'indigo' | 'teal' | 'sky' | 'slate';
    userLink: string;
    adminLink: string;
  }
> = {
  supplies: {
    titleEn: 'General Office Supplies',
    theme: 'amber',
    userLink: '/asset/supplies/inventory',
    adminLink: '/asset/supplies/master/requests',
  },
  it: {
    titleEn: 'IT Infrastructure Assets',
    theme: 'indigo',
    userLink: '/asset/it/personal',
    adminLink: '/asset/it/master/dashboard',
  },
  businesscard: {
    titleEn: 'Business Card Request',
    theme: 'teal',
    userLink: '/asset/businesscard/my-page',
    adminLink: '/asset/businesscard/master/requests',
  },
  production: {
    titleEn: 'Dept Custom Production',
    theme: 'sky',
    userLink: '/asset/production/apply/request',
    adminLink: '/asset/production/master/dashboard',
  },
  other: {
    titleEn: 'Asset Service',
    theme: 'slate',
    userLink: '/asset',
    adminLink: '/asset',
  },
};

export default function AssetIntegratedDashboard() {
  const [stats, setStats] = useState({
    supplies: { myPending: 0, readyPickup: 0 },
    bizcard: { myPending: 0, readyPickup: 0 },
    production: { myPending: 0, inProgress: 0 },
  });
  const [itActiveSurvey, setItActiveSurvey] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [originUrl, setOriginUrl] = useState('');
  const [auditLinkCopied, setAuditLinkCopied] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [l2Menus, setL2Menus] = useState<L2Menu[]>([]);
  const [allMenus, setAllMenus] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [unitsList, setUnitsList] = useState<any[]>([]);

  useEffect(() => {
    setOriginUrl(window.location.origin);

    const getSafeArray = async (res: Response | null) => {
      if (!res || !res.ok) return [];
      try {
        const data = await res.json();
        return Array.isArray(data) ? data : data.data || [];
      } catch {
        return [];
      }
    };

    const syncDashboardMetrics = async () => {
      try {
        const ts = Date.now();
        const [uRes, menuRes, unitsRes, hubMetricsRes, itSurvRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/asset/hub-metrics?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/asset/it/audit?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);

        const menus = await getSafeArray(menuRes);
        const units = await getSafeArray(unitsRes);
        setAllMenus(menus);
        setUnitsList(units);

        const currentUserData = uRes && uRes.ok ? await uRes.json() : null;
        setCurrentUser(currentUserData);

        const assetL1 = menus.find(
          (m: any) =>
            Number(m.level) === 1 &&
            String(m.path || '')
              .replace(/\/$/, '')
              .toLowerCase() === '/asset'
        );

        const l2 = menus
          .filter(
            (m: any) =>
              Number(m.level) === 2 &&
              m.parent_id === assetL1?.id &&
              m.is_visible !== false
          )
          .filter((m: any) =>
            currentUserData
              ? checkMenuPermission(currentUserData, m, menus, units).hasAccess
              : true
          )
          .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
        setL2Menus(l2);

        if (currentUserData) {
          const hasManagerPermission =
            currentUserData.roles?.includes('LV_1') ||
            currentUserData.roles?.includes('LV_2') ||
            currentUserData.isAssetAdmin === true;
          setIsManager(hasManagerPermission);

          const itSurveys = await getSafeArray(itSurvRes);
          const activeSurvey = itSurveys.find((s: any) => s.status === '진행중');
          setItActiveSurvey(activeSurvey || null);

          let hubMetrics: any = null;
          if (hubMetricsRes && hubMetricsRes.ok) {
            try {
              hubMetrics = await hubMetricsRes.json();
            } catch {
              hubMetrics = null;
            }
          }

          setStats({
            supplies: {
              myPending: Number(hubMetrics?.supplies?.myPending) || 0,
              readyPickup: Number(hubMetrics?.supplies?.readyPickup) || 0,
            },
            bizcard: {
              myPending: Number(hubMetrics?.bizcard?.myPending) || 0,
              readyPickup: Number(hubMetrics?.bizcard?.readyPickup) || 0,
            },
            production: {
              myPending: Number(hubMetrics?.production?.myPending) || 0,
              inProgress: Number(hubMetrics?.production?.inProgress) || 0,
            },
          });
        }
      } catch (err) {
        console.error('Asset Dashboard Sync Error:', err);
      } finally {
        setLoading(false);
      }
    };
    syncDashboardMetrics();
  }, []);

  const cards = useMemo(() => {
    return l2Menus.map((menu) => {
      const key = resolveDomainKey(menu.path);
      const meta = DOMAIN_META[key];
      const userLink =
        currentUser && allMenus.length > 0
          ? resolveEntryHref(menu, allMenus, currentUser, unitsList)
          : meta.userLink;
      // supplies: 신규 신청 → inventory / production: 신청 경로 유지
      const resolvedUserLink =
        key === 'supplies' || key === 'production'
          ? meta.userLink
          : userLink || meta.userLink;

      return {
        id: menu.id,
        key,
        // Interface 스탭2 상세설정: name / icon / Card Description(description)
        title: String(menu.name || '').trim(),
        titleEn: meta.titleEn,
        desc: String(menu.description || '').trim(),
        icon: String(menu.icon || '').trim(),
        theme: meta.theme,
        userLink: resolvedUserLink,
        adminLink: meta.adminLink,
        userButtonLabel:
          key === 'supplies'
            ? '신규 신청하기 →'
            : key === 'it'
              ? '나의 IT·업무자산 →'
              : key === 'businesscard'
                ? '신규 신청하기 →'
                : key === 'production'
                  ? '신규 신청하기 →'
                  : '나의 신청 / 현황 →',
        showAdminButton: canAccessAdminPath(
          meta.adminLink,
          currentUser,
          allMenus,
          unitsList
        ),
      };
    });
  }, [l2Menus, currentUser, allMenus, unitsList]);

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-[1600px] mx-auto">
          <p className="text-indigo-400 font-black tracking-widest text-[11px] uppercase mb-4">
            Resource Command Center
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            경영기획센터 관리자산 대시보드
          </h1>
          <p className="text-slate-400 mt-4 font-medium max-w-2xl leading-relaxed">
            KPCQA 전사가 신청가능한 비품 현황,
            <br />
            IT 업무용 자산 대장, 명함신청, 외주 제작 진행을 통합 관제합니다.
            <br />
          
          </p>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 -mt-16 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {cards.map((card) => (
            <HubCard
              key={card.id}
              title={card.title}
              titleEn={card.titleEn}
              desc={card.desc}
              icon={card.icon}
              theme={card.theme}
              myPendingCount={
                card.key === 'supplies'
                  ? stats.supplies.myPending
                  : card.key === 'businesscard'
                    ? stats.bizcard.myPending
                    : card.key === 'production'
                      ? stats.production.myPending
                      : undefined
              }
              myPendingLabel={
                card.key === 'production' ? '나의 접수·발주대기' : '나의 신청대기'
              }
              rightCount={
                card.key === 'supplies'
                  ? stats.supplies.readyPickup
                  : card.key === 'businesscard'
                    ? stats.bizcard.readyPickup
                    : card.key === 'production'
                      ? stats.production.inProgress
                      : undefined
              }
              rightLabel={
                card.key === 'supplies'
                  ? '수령대기'
                  : card.key === 'businesscard'
                    ? '수령대기'
                    : card.key === 'production'
                      ? '제작진행'
                      : '전사 신청대기'
              }
              userLink={card.userLink}
              adminLink={card.adminLink}
              userButtonLabel={card.userButtonLabel}
              showAdminButton={card.showAdminButton}
              isManager={isManager}
              customContent={
                card.key === 'it' ? (
                  <div className="w-full">
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">
                      실사진행현황
                    </p>
                    {itActiveSurvey ? (
                      <div className="text-[11px] font-bold text-slate-700 leading-snug bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                        <span className="text-indigo-600 font-black block mb-0.5">
                          실사 진행중 🚨
                        </span>
                        <span className="text-slate-500 text-[10px]">
                          ({itActiveSurvey.startDate} ~ {itActiveSurvey.endDate})
                        </span>
                        {originUrl ? (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-slate-600 truncate">
                              모바일(사내WiFi) 실사 URL
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                const link = `${originUrl}/audit/public/${itActiveSurvey.id}`;
                                try {
                                  await navigator.clipboard.writeText(link);
                                  setAuditLinkCopied(true);
                                  window.setTimeout(() => setAuditLinkCopied(false), 1500);
                                } catch {
                                  alert(
                                    `클립보드 복사에 실패했습니다.\n아래 링크를 직접 선택해 복사하세요.\n\n${link}`
                                  );
                                }
                              }}
                              className="shrink-0 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[9px] font-black hover:bg-indigo-700 transition-colors"
                            >
                              {auditLinkCopied ? '복사됨' : '복사'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-sm opacity-70">⏸️</span>
                        <span className="text-lg font-black text-slate-400 tracking-tight">
                          실사 대기중
                        </span>
                      </div>
                    )}
                  </div>
                ) : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type HubCardProps = {
  title: string;
  titleEn: string;
  desc: string;
  icon: string;
  theme: 'amber' | 'indigo' | 'teal' | 'sky' | 'slate';
  myPendingCount?: number;
  myPendingLabel?: string;
  rightCount?: number;
  rightLabel?: string;
  userLink: string;
  adminLink: string;
  userButtonLabel?: string;
  showAdminButton?: boolean;
  isManager: boolean;
  customContent?: React.ReactNode;
};

const HubCard = ({
  title,
  titleEn,
  desc,
  icon,
  theme,
  myPendingCount,
  myPendingLabel = '나의 신청대기',
  rightCount,
  rightLabel = '전사 신청대기',
  userLink,
  adminLink,
  userButtonLabel = '나의 신청 / 현황 →',
  showAdminButton = false,
  isManager: _isManager,
  customContent,
}: HubCardProps) => {
  const colors: Record<
    HubCardProps['theme'],
    { iconBg: string; btnPrimary: string; badge: string; warnColor: string }
  > = {
    amber: {
      iconBg: 'bg-amber-50 text-amber-600',
      btnPrimary: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20 text-white',
      badge: 'bg-amber-100 text-amber-700',
      warnColor: 'text-amber-600',
    },
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600',
      btnPrimary: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20 text-white',
      badge: 'bg-indigo-100 text-indigo-700',
      warnColor: 'text-indigo-600',
    },
    teal: {
      iconBg: 'bg-teal-50 text-teal-600',
      btnPrimary: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20 text-white',
      badge: 'bg-teal-100 text-teal-700',
      warnColor: 'text-teal-600',
    },
    sky: {
      iconBg: 'bg-sky-50 text-sky-600',
      btnPrimary: 'bg-sky-600 hover:bg-sky-700 shadow-sky-600/20 text-white',
      badge: 'bg-sky-100 text-sky-700',
      warnColor: 'text-sky-600',
    },
    slate: {
      iconBg: 'bg-slate-100 text-slate-600',
      btnPrimary: 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/20 text-white',
      badge: 'bg-slate-200 text-slate-700',
      warnColor: 'text-slate-600',
    },
  };
  const c = colors[theme];

  return (
    <div className="bg-white rounded-[1.75rem] p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-200/80 transition-all duration-300 hover:shadow-[0_16px_36px_rgb(0,0,0,0.07)] flex flex-col h-full min-h-[340px]">
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-2xl shadow-sm ${c.iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black text-slate-900 tracking-tight leading-tight">
            {title}
          </h2>
          <span
            className={`inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase leading-none ${c.badge}`}
          >
            {titleEn}
          </span>
        </div>
      </div>

      {/* 설명 영역 고정 2줄 → 아래 구분선 시작점 정렬 */}
      <div className="h-[2.75rem] mb-4">
        <p className="text-[12px] text-slate-500 font-medium leading-[1.375rem] line-clamp-2">
          {desc}
        </p>
      </div>

      <div className="flex-1 border-t border-slate-100 pt-3 mb-4">
        {customContent ? (
          customContent
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p
                className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${c.warnColor}`}
              >
                {myPendingLabel}
              </p>
              <div className="flex items-baseline gap-0.5">
                <span className={`text-2xl font-black tracking-tighter ${c.warnColor}`}>
                  {myPendingCount || 0}
                </span>
                <span className={`text-[10px] font-bold ${c.warnColor} opacity-70`}>건</span>
              </div>
            </div>
            <div className="pl-3 border-l border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest mb-0.5 text-slate-500">
                {rightLabel}
              </p>
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-black tracking-tighter text-slate-800">
                  {rightCount || 0}
                </span>
                <span className="text-[10px] font-bold text-slate-500">건</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        <Link
          href={userLink}
          className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-black text-[11px] shadow-sm uppercase tracking-wider transition-all active:scale-[0.98] ${c.btnPrimary}`}
        >
          {userButtonLabel}
        </Link>
        {showAdminButton ? (
          <Link
            href={adminLink}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-black text-[11px] text-slate-200 bg-slate-800 hover:bg-slate-900 border border-slate-700/60 shadow-sm uppercase tracking-wider transition-all active:scale-[0.98]"
          >
            관리자 패널 제어 →
          </Link>
        ) : null}
      </div>
    </div>
  );
};
