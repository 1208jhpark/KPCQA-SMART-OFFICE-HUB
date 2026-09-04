'use client';

import { useEffect, useMemo, useState } from 'react';

/** Step4 L4 카드 → 별도 경로 탭 네비용 정의 (문구는 InterfaceConfig에서 로드) */
export type InterfaceStepTabDef = {
  id: string;
  path: string;
  fallbackName: string;
  fallbackIcon?: string;
  activeColor?: string;
  /** survey 등에서 쓰는 활성 클래스 전체 */
  activeClass?: string;
  exact?: boolean;
};

export type InterfaceMenuRow = {
  id?: string;
  path: string;
  name: string;
  icon?: string | null;
  sort_order?: number;
  is_active?: boolean;
  is_visible?: boolean;
  parent_id?: string | null;
  page_title?: string | null;
};

export type ResolvedInterfaceStepTab = InterfaceStepTabDef & {
  label: string;
  sortOrder: number;
};

export function formatInterfaceMenuLabel(
  icon: string | null | undefined,
  name: string
): string {
  const label = String(name || '').trim();
  const ic = String(icon || '').trim();
  if (!ic) return label;
  if (label.startsWith(ic)) return label;
  return `${ic} ${label}`;
}

/**
 * admin/interface 목록으로 Step4 탭 라벨·정렬·숨김을 해석합니다.
 * pathPrefix가 있으면 해당 하위 메뉴만 매칭에 사용합니다.
 */
export function resolveInterfaceStepTabs(
  defs: readonly InterfaceStepTabDef[],
  interfaces: InterfaceMenuRow[],
  pathPrefix?: string
): ResolvedInterfaceStepTab[] {
  const scoped = pathPrefix
    ? interfaces.filter((m) => m?.path && String(m.path).startsWith(pathPrefix))
    : interfaces;

  const byPath = new Map(scoped.map((m) => [m.path, m] as const));

  return defs
    .map((def) => {
      const menu = byPath.get(def.path);
      const hidden = menu && (menu.is_active === false || menu.is_visible === false);
      if (hidden) return null;
      return {
        ...def,
        sortOrder: menu?.sort_order ?? 999,
        label: menu
          ? formatInterfaceMenuLabel(menu.icon, menu.name || def.fallbackName)
          : formatInterfaceMenuLabel(def.fallbackIcon, def.fallbackName),
      };
    })
    .filter((t): t is ResolvedInterfaceStepTab => t != null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.path.localeCompare(b.path));
}

/** `/api/admin/interface`를 로드해 Step4 탭 문구를 반환 */
export function useInterfaceStepTabs(
  defs: readonly InterfaceStepTabDef[],
  pathPrefix: string
): ResolvedInterfaceStepTab[] {
  /** null = 로딩 중. 빈 배열 fallback을 먼저 그리면 admin 문구와 어긋나 1~2초 깜빡임 */
  const [interfaces, setInterfaces] = useState<InterfaceMenuRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ts = Date.now();
    fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (!cancelled) setInterfaces(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setInterfaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () =>
      interfaces == null
        ? []
        : resolveInterfaceStepTabs(defs, interfaces, pathPrefix),
    [defs, interfaces, pathPrefix]
  );
}

/* ——— Step4 탭 정의 (경로·색만 고정, 문구는 InterfaceConfig) ——— */

export const PRODUCTION_DEPT_MASTER_TABS: InterfaceStepTabDef[] = [
  {
    id: 'order',
    path: '/asset/production/dept-master/order',
    fallbackName: '부서 발주 대장',
    fallbackIcon: '📦',
    activeColor: 'text-indigo-600',
  },
  {
    id: 'inspection',
    path: '/asset/production/dept-master/inspection',
    fallbackName: '발주/수령 검수',
    fallbackIcon: '🧾',
    activeColor: 'text-emerald-600',
  },
  {
    id: 'archive',
    path: '/asset/production/dept-master/archive',
    fallbackName: '정산 보관함',
    fallbackIcon: '📁',
    activeColor: 'text-slate-800',
  },
];

/** 제작물 마스터(경영실) — 명함 master 탭 규격과 동일 */
export const PRODUCTION_MASTER_TABS: InterfaceStepTabDef[] = [
  {
    id: 'dashboard',
    path: '/asset/production/master/dashboard',
    fallbackName: '검수 완료 보관함',
    fallbackIcon: '🗂️',
    activeColor: 'text-indigo-600',
  },
  {
    id: 'invoice',
    path: '/asset/production/master/invoice',
    fallbackName: '명세·정산 대조',
    fallbackIcon: '🧾',
    activeColor: 'text-emerald-600',
  },
  {
    id: 'archive',
    path: '/asset/production/master/archive',
    fallbackName: '정산 완료 아카이브',
    fallbackIcon: '📁',
    activeColor: 'text-slate-800',
  },
];

export const BUSINESS_CARD_MASTER_TABS: InterfaceStepTabDef[] = [
  {
    id: 'requests',
    path: '/asset/businesscard/master/requests',
    fallbackName: '사용자 신청현황 관리',
    fallbackIcon: '📋',
    activeColor: 'text-indigo-600',
  },
  {
    id: 'order',
    path: '/asset/businesscard/master/order',
    fallbackName: '접수/발주/발주·수령 검수',
    fallbackIcon: '🧾',
    activeColor: 'text-emerald-600',
  },
  {
    id: 'archive',
    path: '/asset/businesscard/master/archive',
    fallbackName: '검수 완료 보관함',
    fallbackIcon: '🗂️',
    activeColor: 'text-slate-800',
  },
];

export const IT_MASTER_TABS: InterfaceStepTabDef[] = [
  {
    id: 'dashboard',
    path: '/asset/it/master/dashboard',
    fallbackName: '전사 IT·업무자산 대시보드',
    fallbackIcon: '📊',
    activeColor: 'text-indigo-600',
  },
  {
    id: 'audit',
    path: '/asset/it/master/audit',
    fallbackName: '정기 자산 실사 관리',
    fallbackIcon: '🔍',
    activeColor: 'text-teal-700',
  },
  {
    id: 'requests',
    path: '/asset/it/master/requests',
    fallbackName: '기타 의견/요청 송수신 대장',
    fallbackIcon: '📋',
    activeColor: 'text-pink-600',
  },
  {
    id: 'archive',
    path: '/asset/it/master/archive',
    fallbackName: '종료 처리 아카이브',
    fallbackIcon: '📁',
    activeColor: 'text-slate-800',
  },
];

export const SUPPLIES_MASTER_TABS: InterfaceStepTabDef[] = [
  {
    id: 'dashboard',
    path: '/asset/supplies/master/dashboard',
    fallbackName: '소모품 마스터 대시보드',
    fallbackIcon: '🗂️',
    activeColor: 'text-indigo-600',
  },
  {
    id: 'requests',
    path: '/asset/supplies/master/requests',
    fallbackName: '사용자 신청현황 관리',
    fallbackIcon: '📋',
    activeColor: 'text-emerald-700',
  },
  {
    id: 'purchase',
    path: '/asset/supplies/master/purchase',
    fallbackName: '입고/구매 내역 대장',
    fallbackIcon: '💰',
    activeColor: 'text-amber-700',
  },
  {
    id: 'archive',
    path: '/asset/supplies/master/archive',
    fallbackName: '폐기자산 아카이브',
    fallbackIcon: '📁',
    activeColor: 'text-slate-800',
  },
];

export const SURVEY_GENERAL_ADMIN_TABS: InterfaceStepTabDef[] = [
  {
    id: 'active',
    path: '/survey/general/admin/active-surveys',
    fallbackName: '현재 진행중인 조사',
    fallbackIcon: '📋',
    activeClass: 'bg-white text-emerald-700 shadow-sm border border-slate-200/80',
  },
  {
    id: 'history',
    path: '/survey/general/admin/survey-history',
    fallbackName: '전체 조사 이력 관리',
    fallbackIcon: '🗂️',
    activeClass: 'bg-white text-slate-800 shadow-sm border border-slate-200/80',
  },
];

export const SURVEY_DELIVERY_ADMIN_TABS: InterfaceStepTabDef[] = [
  {
    id: 'active',
    path: '/survey/delivery/admin/active-surveys',
    fallbackName: '상시/기간 배달 신청 현황',
    fallbackIcon: '📋',
    exact: true,
    activeClass: 'bg-white text-emerald-700 shadow-sm border border-slate-200/80',
  },
  {
    id: 'history',
    path: '/survey/delivery/admin/history',
    fallbackName: '배송조사 결과 이력 관리',
    fallbackIcon: '🗂️',
    exact: false,
    activeClass: 'bg-white text-slate-800 shadow-sm border border-slate-200/80',
  },
];
