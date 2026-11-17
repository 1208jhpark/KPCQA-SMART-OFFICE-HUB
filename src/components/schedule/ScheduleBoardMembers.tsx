'use client';

import React, { useEffect, useState } from 'react';

type BoardMember = {
  id: string;
  name: string;
  email?: string;
  duty?: string;
};

/** `/schedule/dashboard` · `/schedule/work-board` 상단 공유 멤버 */
export default function ScheduleBoardMembers() {
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
    <section className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
          Board Members
        </p>
        <p className="text-[11px] font-medium text-slate-800">
          공유일정
          <span className="mx-1.5 inline-block text-slate-300 select-none" aria-hidden>
            ·
          </span>
          워크보드를 공유하는 사람
          {unitName ? (
            <span className="text-slate-500 font-normal">
              <span className="mx-1.5 inline-block text-slate-300 select-none" aria-hidden>
                ·
              </span>
              {unitName}
            </span>
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
                <span className="truncate text-[10px] font-normal text-slate-400">{m.duty}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
