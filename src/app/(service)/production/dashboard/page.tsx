'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { checkMenuPermission } from '@/lib/permission-utils';
import { resolveEntryHref } from '@/lib/resolve-entry-href';

type HubKey = 'my-orders' | 'dept-master' | 'clients' | 'admin';
type Theme = 'indigo' | 'amber' | 'teal' | 'slate';

type HubLink = {
  href: string;
  label: string;
  /** Access 검사 path (없으면 href) */
  accessPath?: string;
  primary?: boolean;
};

type HubDef = {
  key: HubKey;
  path: string;
  titleEn: string;
  theme: Theme;
  fallbackTitle: string;
  fallbackIcon: string;
  fallbackDesc: string;
  buttonLabel: string;
  defaultEntry: string;
  /** 있으면 카드에 복수 바로가기 버튼 */
  links?: HubLink[];
};

const MY_ORDERS_REQUEST = '/production/custom/my-orders/request';
const MY_ORDERS_HISTORY = '/production/custom/my-orders/history';
const DEPT_MASTER_ORDER = '/production/custom/dept-master/order';
const DEPT_MASTER_HISTORY = '/production/custom/dept-master/history';

const ADMIN_DASHBOARD = '/production/custom/admin/dashboard';

/** 일상 업무 카드 (상단) */
const MAIN_HUBS: HubDef[] = [
  {
    key: 'my-orders',
    path: '/production/custom/my-orders',
    titleEn: 'My Orders',
    theme: 'indigo',
    fallbackTitle: '나의 신청',
    fallbackIcon: '📋',
    fallbackDesc: '맞춤 제작물 신규 신청과 나의 진행·수령 이력을 확인합니다.',
    buttonLabel: '나의 신청으로 →',
    defaultEntry: MY_ORDERS_REQUEST,
    links: [
      {
        href: MY_ORDERS_REQUEST,
        accessPath: MY_ORDERS_REQUEST,
        label: '신규 신청 →',
        primary: true,
      },
      {
        href: MY_ORDERS_HISTORY,
        accessPath: MY_ORDERS_HISTORY,
        label: '나의 이력 →',
        primary: false,
      },
    ],
  },
  {
    key: 'dept-master',
    path: '/production/custom/dept-master',
    titleEn: 'Dept Master',
    theme: 'amber',
    fallbackTitle: '부서 마스터',
    fallbackIcon: '🏢',
    fallbackDesc: '부서 발주 대장·수령검수·명세서 정산을 관리합니다.',
    buttonLabel: '부서 마스터로 →',
    defaultEntry: DEPT_MASTER_ORDER,
    links: [
      {
        href: DEPT_MASTER_ORDER,
        accessPath: DEPT_MASTER_ORDER,
        label: '발주 대장 →',
        primary: true,
      },
      {
        href: DEPT_MASTER_HISTORY,
        accessPath: DEPT_MASTER_HISTORY,
        label: '부서 전체 이력 →',
        primary: false,
      },
    ],
  },
  {
    key: 'clients',
    path: '/production/custom/clients',
    titleEn: 'Client Address',
    theme: 'teal',
    fallbackTitle: '고객사 주소',
    fallbackIcon: '📍',
    fallbackDesc: '제작물 발송·명함 등에 쓰는 고객사 주소를 관리합니다.',
    buttonLabel: '주소 관리로 →',
    defaultEntry: '/production/custom/clients',
  },
];

/** Access 있는 사용자만 — 하단 길쭉한 마스터 카드 */
const ADMIN_HUB: HubDef = {
  key: 'admin',
  path: '/production/custom/admin',
  titleEn: 'Master Admin',
  theme: 'slate',
  fallbackTitle: '경영기획센터 마스터 관리',
  fallbackIcon: '🛠️',
  fallbackDesc: '전사 검수완료·명세 대조를 통합 관제합니다.',
  buttonLabel: '명세대조 대시보드 →',
  defaultEntry: ADMIN_DASHBOARD,
  links: [
    {
      href: ADMIN_DASHBOARD,
      // Interface Access 기준 경로: /production/custom/admin
      accessPath: '/production/custom/admin',
      label: '명세대조 대시보드 →',
      primary: true,
    },
  ],
};

function normalizePath(path: string) {
  return String(path || '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function findMenuByPath(menus: any[], path: string) {
  const target = normalizePath(path);
  return (
    menus.find((m: any) => normalizePath(m.path) === target) ||
    menus
      .filter((m: any) => {
        const mp = normalizePath(m.path);
        return mp && (target === mp || target.startsWith(`${mp}/`) || mp.startsWith(`${target}/`));
      })
      .sort(
        (a: any, b: any) =>
          String(b.path || '').length - String(a.path || '').length
      )[0] ||
    null
  );
}

/**
 * 허브 path Access — 해당 path 또는 그 하위만 검사.
 * 상위(`/production` 등) Access로 하위 마스터 카드가 열리면 안 됨.
 */
function canAccessHubPath(
  hubPath: string,
  user: any,
  menus: any[],
  units: any[]
): boolean {
  if (!user || !hubPath || !menus.length) return false;
  const target = normalizePath(hubPath);
  const related = menus.filter((m: any) => {
    const mp = normalizePath(m.path);
    if (!mp || mp === '/home') return false;
    return mp === target || mp.startsWith(`${target}/`);
  });
  if (related.length === 0) return false;
  return related.some((m: any) => checkMenuPermission(user, m, menus, units).hasAccess);
}

export default function ProductionDashboardHub() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allMenus, setAllMenus] = useState<any[]>([]);
  const [unitsList, setUnitsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ts = Date.now();
        const [meRes, menuRes, unitsRes] = await Promise.all([
          fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' }).catch(() => null),
        ]);

        const menus =
          menuRes && menuRes.ok
            ? await menuRes.json().then((d) => (Array.isArray(d) ? d : d?.data || []))
            : [];
        const units =
          unitsRes && unitsRes.ok
            ? await unitsRes.json().then((d) => (Array.isArray(d) ? d : d?.data || []))
            : [];
        const me = meRes && meRes.ok ? await meRes.json() : null;
        if (cancelled) return;
        setAllMenus(Array.isArray(menus) ? menus : []);
        setUnitsList(Array.isArray(units) ? units : []);
        setCurrentUser(me);
      } catch (err) {
        console.error('[production/dashboard]', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildCard = (hub: HubDef) => {
    const menu = findMenuByPath(allMenus, hub.path);
    // 사용자·메뉴 미준비/실패 시 카드 숨김 (fail-closed). 로딩 UI는 loading 분기로 처리.
    const ready = Boolean(currentUser) && allMenus.length > 0;
    const hasAccess = ready
      ? canAccessHubPath(hub.path, currentUser, allMenus, unitsList)
      : false;
    const entry =
      menu && currentUser
        ? resolveEntryHref(menu, allMenus, currentUser, unitsList) || hub.defaultEntry
        : hub.defaultEntry;

    const links = (hub.links || [])
      .map((link) => {
        const accessPath = link.accessPath || link.href;
        const allowed = ready
          ? canAccessHubPath(accessPath, currentUser, allMenus, unitsList)
          : false;
        return allowed ? link : null;
      })
      .filter(Boolean) as HubLink[];

    return {
      ...hub,
      title: String(menu?.name || '').trim() || hub.fallbackTitle,
      desc: String(menu?.description || menu?.page_description || '').trim() || hub.fallbackDesc,
      icon: String(menu?.icon || '').trim() || hub.fallbackIcon,
      href: entry,
      links,
      visible: hasAccess && (links.length > 0 || !hub.links),
    };
  };

  const mainCards = useMemo(
    () => MAIN_HUBS.map(buildCard).filter((c) => c.visible),
    [allMenus, currentUser, unitsList]
  );

  const adminCard = useMemo(() => {
    // /production/custom/admin Access 있는 사람만 — 확정 전·상위 메뉴 Access만으로는 숨김
    if (!currentUser || allMenus.length === 0) return null;
    if (!canAccessHubPath('/production/custom/admin', currentUser, allMenus, unitsList)) {
      return null;
    }
    const card = buildCard(ADMIN_HUB);
    return card.visible ? card : null;
  }, [allMenus, currentUser, unitsList]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24">
      <div className="bg-slate-900 pt-16 pb-32 px-6">
        <div className="max-w-[1600px] mx-auto">
          <p className="text-indigo-400 font-black tracking-widest text-[11px] uppercase mb-4">
            PRODUCTION CENTER
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            제작 대시보드
          </h1>
          <p className="mt-3 text-sm font-medium text-slate-400 max-w-2xl leading-relaxed">
            나의 신청 · 부서 마스터 · 고객사 주소로 바로 이동합니다.
          </p>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 md:px-6 -mt-16 relative z-10">
        {/* 상단 3카드 총너비(22rem×3 + gap-5×2)와 마스터 카드 폭 정렬 */}
        <div className="mx-auto w-full max-w-[68.5rem] space-y-5">
          {loading ? (
            <div className="bg-white rounded-[1.75rem] border border-slate-200 p-16 text-center text-slate-400 text-sm font-medium shadow-sm">
              메뉴를 불러오는 중…
            </div>
          ) : mainCards.length === 0 && !adminCard ? (
            <div className="bg-white rounded-[1.75rem] border border-slate-200 p-16 text-center text-slate-400 text-sm font-medium shadow-sm">
              접근 가능한 제작 메뉴가 없습니다.
            </div>
          ) : (
            <>
              {mainCards.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-5">
                  {mainCards.map((card) => (
                    <div
                      key={card.key}
                      className="w-full max-w-sm md:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-0.875rem)] xl:max-w-[22rem]"
                    >
                      <ProductionHubCard
                        title={card.title}
                        titleEn={card.titleEn}
                        desc={card.desc}
                        icon={card.icon}
                        theme={card.theme}
                        href={card.href}
                        buttonLabel={card.buttonLabel}
                        links={card.links}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              {adminCard ? (
                <ProductionAdminWideCard
                  title={adminCard.title}
                  titleEn={adminCard.titleEn}
                  desc={adminCard.desc}
                  icon={adminCard.icon}
                  href={adminCard.href}
                  buttonLabel={adminCard.buttonLabel}
                  links={adminCard.links}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type CardProps = {
  title: string;
  titleEn: string;
  desc: string;
  icon: string;
  theme: Theme;
  href: string;
  buttonLabel: string;
  links?: HubLink[];
};

const THEME: Record<
  Theme,
  { iconBg: string; btn: string; badge: string }
> = {
  indigo: {
    iconBg: 'bg-indigo-50 text-indigo-600',
    btn: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20 text-white',
    badge: 'bg-indigo-100 text-indigo-700',
  },
  amber: {
    iconBg: 'bg-amber-50 text-amber-600',
    btn: 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20 text-white',
    badge: 'bg-amber-100 text-amber-700',
  },
  teal: {
    iconBg: 'bg-teal-50 text-teal-600',
    btn: 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/20 text-white',
    badge: 'bg-teal-100 text-teal-700',
  },
  slate: {
    iconBg: 'bg-slate-100 text-slate-600',
    btn: 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/20 text-white',
    badge: 'bg-slate-200 text-slate-700',
  },
};

function ProductionHubCard({
  title,
  titleEn,
  desc,
  icon,
  theme,
  href,
  buttonLabel,
  links,
}: CardProps) {
  const c = THEME[theme];
  const actions =
    links && links.length > 0
      ? links
      : [{ href, label: buttonLabel, primary: true }];

  return (
    <div className="bg-white rounded-[1.75rem] p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-200/80 transition-all duration-300 hover:shadow-[0_16px_36px_rgb(0,0,0,0.07)] flex flex-col h-full min-h-[280px]">
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-2xl shadow-sm ${c.iconBg}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium text-slate-900 tracking-tight leading-tight">
            {title}
          </h2>
          <span
            className={`inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-medium tracking-widest uppercase leading-none ${c.badge}`}
          >
            {titleEn}
          </span>
        </div>
      </div>

      <div className="h-[2.75rem] mb-4">
        <p className="text-[12px] text-slate-500 font-medium leading-[1.375rem] line-clamp-2">
          {desc}
        </p>
      </div>

      <div className="mt-auto pt-3 border-t border-slate-100 flex flex-col gap-2">
        {actions.map((action) => {
          const isPrimary = action.primary !== false || actions.length === 1;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-medium text-[11px] shadow-sm uppercase tracking-wider transition-all active:scale-[0.98] ${
                isPrimary
                  ? c.btn
                  : 'text-slate-200 bg-slate-800 hover:bg-slate-900 border border-slate-700/60'
              }`}
            >
              {action.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Access 전용 — 하단 풀와이드 마스터 카드 */
function ProductionAdminWideCard({
  title,
  titleEn,
  desc,
  icon,
  href,
  buttonLabel,
  links,
}: Omit<CardProps, 'theme'>) {
  const actions =
    links && links.length > 0
      ? links
      : [{ href, label: buttonLabel, primary: true }];

  return (
    <div className="w-full bg-slate-900 rounded-[1.75rem] p-5 md:px-8 md:py-6 shadow-[0_12px_36px_rgb(15,23,42,0.18)] border border-slate-700/80 transition-all duration-300 hover:shadow-[0_16px_40px_rgb(15,23,42,0.28)]">
      <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-8">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-2xl shadow-sm bg-white/10 text-white">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg md:text-xl font-medium text-white tracking-tight leading-tight">
                {title}
              </h2>
              <span className="inline-block px-2 py-0.5 rounded text-[9px] font-medium tracking-widest uppercase leading-none bg-white/10 text-slate-200">
                {titleEn}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-400 font-medium leading-relaxed line-clamp-2">
              {desc}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 shrink-0 md:min-w-[280px]">
          {actions.map((action) => {
            const isPrimary = action.primary !== false || actions.length === 1;
            return (
              <Link
                key={action.href}
                href={action.href}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-medium text-[11px] shadow-sm uppercase tracking-wider transition-all active:scale-[0.98] whitespace-nowrap ${
                  isPrimary
                    ? 'bg-white text-slate-900 hover:bg-slate-100'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-600/80'
                }`}
              >
                {action.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
