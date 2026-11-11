'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isSystemLv1User } from '@/lib/permission-utils';
import {
  useInterfaceStepTabs,
  type InterfaceStepTabDef,
} from '@/lib/interface-step-tabs';

type BannerTone = 'slate' | 'emerald';
type BannerLead = 'user' | 'dept' | 'none';

type PermissionSummary = {
  masterName: string;
  accessDesignate: string;
  accessOrg: string;
  accessLevel: string;
  editDesignate: string;
  editLevel: string;
};

type Props = {
  titleEn: string;
  title: string;
  description: string;
  tabs: readonly InterfaceStepTabDef[];
  tabPrefix: string;
  children?: React.ReactNode;
  hideUserName?: boolean;
  bannerLead?: BannerLead;
  bannerTone?: BannerTone;
  /** LV_1에게만 Master/Access/Edit 칩 표시 (admin/interface summary) */
  showPermissionChips?: boolean;
  /** summary API path — 미지정 시 현재 pathname */
  menuPath?: string;
};

const BANNER: Record<
  BannerTone,
  { wrap: string; orb: string; orb2?: string; label: string; desc: string }
> = {
  slate: {
    wrap: 'bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800',
    orb: 'bg-sky-500/12',
    label: 'text-sky-400',
    desc: 'text-slate-400',
  },
  emerald: {
    wrap: 'bg-gradient-to-r from-emerald-900 to-teal-900',
    orb: 'bg-emerald-400/15',
    orb2: 'bg-teal-800/20',
    label: 'text-emerald-400',
    desc: 'text-emerald-100/90',
  },
};

export default function CorpCardScaffold({
  titleEn,
  title,
  description,
  tabs: tabDefs,
  tabPrefix,
  children,
  hideUserName = false,
  bannerLead = 'user',
  bannerTone = 'slate',
  showPermissionChips = false,
  menuPath,
}: Props) {
  const pathname = usePathname() || '';
  const tabs = useInterfaceStepTabs(tabDefs, tabPrefix);
  const [userName, setUserName] = useState('');
  const [deptName, setDeptName] = useState('');
  const [currentUser, setCurrentUser] = useState<unknown>(null);
  const [permissionSummary, setPermissionSummary] = useState<PermissionSummary | null>(
    null
  );
  const banner = BANNER[bannerTone];
  const lead = hideUserName ? 'none' : bannerLead;
  const summaryPath = String(menuPath || pathname || '').trim();

  useEffect(() => {
    let cancelled = false;
    const ts = Date.now();
    (async () => {
      try {
        const meRes = await fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' });
        const user = meRes.ok ? await meRes.json() : null;
        if (cancelled) return;
        setCurrentUser(user);
        if (lead !== 'none') {
          setUserName(String(user?.name || '').trim());
          setDeptName(
            String(user?.unit?.unit_name || user?.dept_name || '').trim()
          );
        } else {
          setUserName('');
          setDeptName('');
        }

        if (!showPermissionChips || !summaryPath) {
          setPermissionSummary(null);
          return;
        }
        const summaryRes = await fetch(
          `/api/admin/interface/summary?path=${encodeURIComponent(summaryPath)}&t=${ts}`,
          { cache: 'no-store' }
        );
        if (!cancelled) {
          setPermissionSummary(summaryRes.ok ? await summaryRes.json() : null);
        }
      } catch {
        if (cancelled) return;
        setCurrentUser(null);
        setPermissionSummary(null);
        setUserName('');
        setDeptName('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead, showPermissionChips, summaryPath]);

  const showChips =
    showPermissionChips && permissionSummary && isSystemLv1User(currentUser);
  const chipMaster =
    bannerTone === 'emerald'
      ? 'bg-white/10 border-white/25 text-emerald-50'
      : 'bg-white/10 border-white/25 text-slate-100';
  const chipEdit =
    bannerTone === 'emerald'
      ? 'bg-emerald-400/20 border-emerald-300/40 text-emerald-100'
      : 'bg-sky-400/20 border-sky-300/40 text-sky-100';

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in text-[11px]">
      <div
        className={`w-full ${banner.wrap} rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6`}
      >
        <div
          className={`absolute right-0 top-0 w-64 h-64 ${banner.orb} rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none`}
        />
        {banner.orb2 ? (
          <div
            className={`absolute left-1/4 bottom-0 w-48 h-48 ${banner.orb2} rounded-full blur-3xl translate-y-1/2 pointer-events-none`}
          />
        ) : null}
        <div className="relative z-10">
          <h3
            className={`text-[10px] font-medium uppercase tracking-widest ${banner.label} mb-2.5`}
          >
            {titleEn}
          </h3>
          <h1 className="text-2xl tracking-tight leading-none">
            {lead === 'dept' ? (
              <>
                <span className={`${banner.label} font-normal`}>
                  {deptName || '소속 부서'}
                </span>
                <span className="text-white/30 font-normal mx-2.5">|</span>
              </>
            ) : lead === 'user' && userName ? (
              <>
                <span className={`${banner.label} font-normal`}>{userName} 님</span>
                <span className="text-white/30 font-normal mx-2.5">|</span>
              </>
            ) : null}
            <span className="text-white font-medium">{title}</span>
          </h1>
          <p className={`${banner.desc} text-xs mt-3 leading-relaxed`}>{description}</p>
          {showChips ? (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight shadow-sm ${chipMaster}`}
              >
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">
                  Org: {permissionSummary.accessOrg}
                </span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium border tracking-tight shadow-sm ${chipEdit}`}
              >
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {tabs.length > 1 ? (
        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap min-h-[40px]">
            {tabs.map((tab) => {
              const isActive =
                pathname === tab.path || pathname.startsWith(`${tab.path}/`);
              return (
                <Link
                  key={tab.id}
                  href={tab.path}
                  className={`px-5 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                    isActive
                      ? `bg-white ${tab.activeColor || 'text-sky-600'} shadow-sm border border-slate-200/80`
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {children ?? (
        <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-sky-600" />
              <h2 className="text-sm font-medium text-slate-800 tracking-tight">{title}</h2>
              <span className="text-[11px] font-medium bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">
                0건
              </span>
            </div>
          </div>
          <div className="p-16 text-center text-slate-400 text-xs font-medium">
            화면 설계 준비 중입니다.
          </div>
        </div>
      )}
    </div>
  );
}
