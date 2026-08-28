'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IT_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

type PermissionSummary = {
  masterName: string;
  accessDesignate: string;
  accessOrg: string;
  accessLevel: string;
  editDesignate: string;
  editLevel: string;
};

export default function ItMasterPageBanner({
  label,
  title,
  description,
  menuPath,
  bannerAction,
  canEdit = true,
}: {
  label: string;
  title: string;
  description: string;
  menuPath: string;
  bannerAction?: React.ReactNode;
  /** false면 Access/Edit 칩 옆에 편집 권한 없음 안내 */
  canEdit?: boolean;
}) {
  const pathname = usePathname() || '';
  const tabs = useInterfaceStepTabs(IT_MASTER_TABS, '/asset/it/master');
  const [permissionSummary, setPermissionSummary] = useState<PermissionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/interface/summary?path=${encodeURIComponent(menuPath)}&t=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (!cancelled && res.ok) setPermissionSummary(await res.json());
        else if (!cancelled) setPermissionSummary(null);
      } catch {
        if (!cancelled) setPermissionSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuPath]);

  return (
    <>
      <div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="min-w-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
              {label}
            </h3>
            <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
              {title}
            </h1>
            <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
              {description}
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
                {!canEdit && (
                  <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                    편집 권한 없음 — 조회만 가능
                  </span>
                )}
              </div>
            )}
          </div>
          {bannerAction}
        </div>
      </div>

      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname === tab.path || pathname.startsWith(`${tab.path}/`);
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
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden lg:block">
          ※ 탭을 클릭하여 대시보드·실사·요청·아카이브를 전환합니다.
        </p>
      </div>
    </>
  );
}
