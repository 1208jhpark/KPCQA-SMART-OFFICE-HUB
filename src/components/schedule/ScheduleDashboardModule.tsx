'use client';

import React, { useEffect, useState } from 'react';
import DeptSharedCalendar from '@/components/schedule/DeptSharedCalendar';

type BoardMember = {
  id: string;
  name: string;
  email?: string;
  duty?: string;
};

/**
 * `/schedule/dashboard` — Shared Team Calendar + Detail
 * (마케팅 대시보드 하단 일정 영역 복사)
 */
export default function ScheduleDashboardModule() {
  const [unitName, setUnitName] = useState('');
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMembersLoading(true);
      setMembersError(null);
      try {
        const res = await fetch(`/api/schedule/board-members?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) {
            setMembers([]);
            setMembersError('공유 멤버를 불러오지 못했습니다.');
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setUnitName(String(data.unitName || '').trim());
        setMembers(Array.isArray(data.members) ? data.members : []);
      } catch {
        if (!cancelled) {
          setMembers([]);
          setMembersError('공유 멤버를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-slate-50 font-sans flex flex-col overflow-hidden">
      <div className="w-full max-w-[1760px] mx-auto flex-1 min-h-0 flex flex-col px-4 md:px-6 pt-5 pb-5 gap-4">
        {/* 이 보드를 공유하는 소속 멤버 */}
        <section className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
              Board Members
            </p>
            <p className="text-[11px] font-medium text-slate-800">
              이 보드를 공유하는 사람
              {unitName ? (
                <span className="text-slate-500 font-normal"> · {unitName}</span>
              ) : null}
            </p>
            {!membersLoading && members.length > 0 && (
              <span className="text-[10px] font-normal text-slate-400 tabular-nums">
                {members.length}명
              </span>
            )}
          </div>

          {membersLoading ? (
            <p className="text-[12px] font-normal text-slate-400">불러오는 중…</p>
          ) : membersError ? (
            <p className="text-[12px] font-normal text-amber-700">{membersError}</p>
          ) : members.length === 0 ? (
            <p className="text-[12px] font-normal text-slate-400">
              동일 소속으로 등록된 사용자가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <li
                  key={m.id}
                  title={m.duty ? `${m.name} · ${m.duty}` : m.name}
                  className="inline-flex items-center gap-1 max-w-full px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[12px] font-medium text-slate-800"
                >
                  <span className="truncate">{m.name}</span>
                  {m.duty ? (
                    <span className="truncate text-[10px] font-normal text-slate-400">
                      {m.duty}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex-1 min-h-0">
          <DeptSharedCalendar />
        </div>
      </div>
    </div>
  );
}
