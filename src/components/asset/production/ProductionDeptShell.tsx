'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  PRODUCTION_DEPT_MASTER_TABS,
  useInterfaceStepTabs,
  type InterfaceMenuRow,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/production/dept-master/order';

type PermissionSummary = {
  masterName: string;
  accessDesignate: string;
  accessOrg: string;
  accessLevel: string;
  editDesignate: string;
  editLevel: string;
};

type ProductionDeptShellProps = {
  children: React.ReactNode;
  pageHint?: string;
};

export default function ProductionDeptShell({ children, pageHint }: ProductionDeptShellProps) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<PermissionSummary | null>(null);
  const [interfaces, setInterfaces] = useState<InterfaceMenuRow[]>([]);
  const tabs = useInterfaceStepTabs(PRODUCTION_DEPT_MASTER_TABS, '/asset/production/dept-master');

  const myDeptName =
    currentUser?.unit?.unit_name ||
    currentUser?.dept_name ||
    '소속 부서';

  useEffect(() => {
    const ts = Date.now();
    Promise.all([
      fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
    ]).then(([user, summary, menus]) => {
      setCurrentUser(user);
      setPermissionSummary(summary);
      setInterfaces(Array.isArray(menus) ? menus : []);
    });
  }, []);

  const bannerTitle = useMemo(() => {
    const current =
      interfaces.find((m) => m.path === pathname) ||
      interfaces.find((m) => pathname.startsWith(m.path)) ||
      interfaces.find((m) => m.path === MENU_PATH);
    if (!current) return '맞춤 제작물 부서 발주';
    const parent = current.parent_id
      ? interfaces.find((m) => m.id === current.parent_id)
      : null;
    const fromParent = String(parent?.page_title || parent?.name || '').trim();
    if (fromParent) return fromParent;
    return String(current.page_title || current.name || '맞춤 제작물 부서 발주').trim();
  }, [interfaces, pathname]);

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      <div className="w-full bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-indigo-500/12 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-slate-500/10 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-2.5">
            PRODUCTION DEPT ORDER CONTROL
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            <span className="text-indigo-400 font-normal">{String(myDeptName)}</span>
            <span className="text-white/30 font-normal mx-2.5">|</span>
            <span className="text-white font-extrabold">{bannerTitle}</span>
          </h1>
          <p className="text-slate-400 text-xs mt-3 leading-relaxed">
            {pageHint ||
              '연계 조직(본인·하위) 임직원의 제작 신청을 검토하고 묶음 발주합니다. master에서는 부서 발주 건을 중앙 대조합니다.'}
          </p>
          {permissionSummary && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-slate-50 shadow-sm">
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
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
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
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden sm:block">
          ※ apply=개인 신청 · dept=부서 묶음 발주 · master=중앙 대조
        </p>
      </div>

      {children}
    </div>
  );
}
