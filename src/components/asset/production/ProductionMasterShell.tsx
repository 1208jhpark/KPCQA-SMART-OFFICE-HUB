'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  PRODUCTION_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/production/master/dashboard';

type PermissionSummary = {
  masterName: string;
  accessDesignate: string;
  accessOrg: string;
  accessLevel: string;
  editDesignate: string;
  editLevel: string;
};

type ProductionMasterShellProps = {
  children: React.ReactNode;
  /** 배너 본문 안내 (기본: 제작물 마스터 공통) */
  pageHint?: string;
};

/**
 * 명함 master(Order/Archive)와 동일 규격 — emerald→teal 배너 + 탭 스위처
 */
export default function ProductionMasterShell({
  children,
  pageHint,
}: ProductionMasterShellProps) {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(PRODUCTION_MASTER_TABS, '/asset/production/master');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<PermissionSummary | null>(null);

  const canEditMaster = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  useEffect(() => {
    const ts = Date.now();
    const summaryPath =
      pathname.startsWith('/asset/production/master/')
        ? pathname
        : MENU_PATH;
    Promise.all([
      fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
      fetch(
        `/api/admin/interface/summary?path=${encodeURIComponent(summaryPath)}&t=${ts}`,
        { cache: 'no-store' }
      )
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([user, menus, summary]) => {
      setCurrentUser(user);
      const row = Array.isArray(menus)
        ? menus.find((m: any) => m.path === summaryPath) ||
          menus.find((m: any) => m.path === MENU_PATH)
        : null;
      setInterfaceConfig(row || null);
      setPermissionSummary(summary);
    });
  }, [pathname]);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      {/* client-search / 명함 master 배너 규격: emerald→teal · orbs · permission chips */}
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
            PRODUCTION TOTAL GOVERNANCE
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            전사 부서 맞춤 제작물 마스터 통제 대장
          </h1>
          <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
            {pageHint ||
              '각 부서에서 발주·수령 검수 완료 후 이관된 제작 묶음을 모아 명세 대조·정산 상태를 관리하는 마스터 컨트롤 허브입니다.'}
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
              {!canEditMaster && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  편집 권한 없음 — 조회만 가능
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 탭 네비게이션 — 명함 master 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap min-h-[40px]">
          {tabs.length === 0 ? (
            <div className="h-8 w-72 rounded-md bg-slate-200/80 animate-pulse" aria-hidden />
          ) : (
            tabs.map((tab) => {
              const isActive = pathname.startsWith(tab.path);
              return (
                <Link
                  key={tab.id}
                  href={tab.path}
                  className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                    isActive
                      ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>{tab.label}</span>
                </Link>
              );
            })
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ 탭을 클릭하여 보관함·명세정산·아카이브를 전환합니다.
        </p>
      </div>

      {children}
    </div>
  );
}
