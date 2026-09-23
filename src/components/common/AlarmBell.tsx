'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ALARM_SNOOZE_DAYS, SNOOZABLE_ALARM_IDS } from '@/lib/alarm-snooze';
import {
  isAlarmDismissed,
  isAlarmFresh,
  mapsDiffer,
  mergeCountMaps,
  parseAlarmCountMap,
  pruneStampsToActive,
  stampOf,
  type AlarmCountStamp,
  type AlarmStamp,
} from '@/lib/alarm-prefs';

type AlarmItem = {
  id: string;
  label: string;
  count: number;
  href: string;
  at?: number;
  date?: string;
  snoozable?: boolean;
};

type Props = {
  userKey?: string;
};

function seenStorageKey(userKey: string) {
  return `wise-alarm-seen:${String(userKey || 'anon').trim().toLowerCase()}`;
}

function dismissedStorageKey(userKey: string) {
  return `wise-alarm-dismissed:${String(userKey || 'anon').trim().toLowerCase()}`;
}

function readLocalCountMap(key: string): AlarmCountStamp {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    return parseAlarmCountMap(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

/** 구형식(at ms / {at,count:0}) → 현재 목록 스탬프로 승격 */
function migrateLegacyLocal(
  key: string,
  items: AlarmItem[],
  base: AlarmCountStamp
): AlarmCountStamp {
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return base;
    const out = { ...base };
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = String(k || '').trim();
      if (!id || out[id] != null) continue;
      const item = byId.get(id);
      if (!item) continue;
      if (typeof v === 'number' && v > 1e11) {
        out[id] = stampOf(item);
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const count = Number((v as { count?: unknown }).count);
        if (!Number.isFinite(count) || count <= 0) out[id] = stampOf(item);
      }
    }
    return out;
  } catch {
    return base;
  }
}

function writeLocalCountMap(key: string, next: AlarmCountStamp) {
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function canSnooze(item: AlarmItem) {
  return item.snoozable === true || SNOOZABLE_ALARM_IDS.has(item.id);
}

export default function AlarmBell({ userKey = '' }: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const loadSeq = useRef(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AlarmItem[]>([]);
  const [seen, setSeen] = useState<AlarmCountStamp>({});
  const [dismissed, setDismissed] = useState<AlarmCountStamp>({});
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const storageKey = String(userKey || '').trim();
  const seenRef = useRef<AlarmCountStamp>({});
  const dismissedRef = useRef<AlarmCountStamp>({});

  const persistLocal = (nextSeen: AlarmCountStamp, nextDismissed: AlarmCountStamp) => {
    if (!storageKey) return;
    writeLocalCountMap(seenStorageKey(storageKey), nextSeen);
    writeLocalCountMap(dismissedStorageKey(storageKey), nextDismissed);
  };

  const applyPrefs = (nextSeen: AlarmCountStamp, nextDismissed: AlarmCountStamp) => {
    seenRef.current = nextSeen;
    dismissedRef.current = nextDismissed;
    setSeen(nextSeen);
    setDismissed(nextDismissed);
    persistLocal(nextSeen, nextDismissed);
  };

  const load = async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/alarms?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== loadSeq.current) return;

      const nextItems: AlarmItem[] = Array.isArray(data.items) ? data.items : [];
      const activeIds: string[] = Array.isArray(data.activeIds)
        ? data.activeIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : nextItems.map((i) => i.id);
      const serverSeen = parseAlarmCountMap(data.seen);
      const serverDismissed = parseAlarmCountMap(data.dismisses);

      let localSeen = storageKey ? readLocalCountMap(seenStorageKey(storageKey)) : {};
      let localDismissed = storageKey
        ? readLocalCountMap(dismissedStorageKey(storageKey))
        : {};
      if (storageKey) {
        localSeen = migrateLegacyLocal(seenStorageKey(storageKey), nextItems, localSeen);
        localDismissed = migrateLegacyLocal(
          dismissedStorageKey(storageKey),
          nextItems,
          localDismissed
        );
      }

      // 대기 0건 알람의 로컬/메모리 스탬프 제거 — merge 전에 해야 ✕ 삭제가 되살아나지 않음
      localSeen = pruneStampsToActive(localSeen, activeIds);
      localDismissed = pruneStampsToActive(localDismissed, activeIds);
      const memSeen = pruneStampsToActive(seenRef.current, activeIds);
      const memDismissed = pruneStampsToActive(dismissedRef.current, activeIds);

      // 배송 대기함 구형식 확인/삭제(at=0)는 재제출과 구분 불가 → 로컬에서도 제거
      for (const id of Object.keys(localSeen)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((localSeen[id]?.at || 0) <= 0) delete localSeen[id];
      }
      for (const id of Object.keys(localDismissed)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((localDismissed[id]?.at || 0) <= 0) delete localDismissed[id];
      }
      for (const id of Object.keys(memSeen)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((memSeen[id]?.at || 0) <= 0) delete memSeen[id];
      }
      for (const id of Object.keys(memDismissed)) {
        if (!id.startsWith('sv-del-pending')) continue;
        if ((memDismissed[id]?.at || 0) <= 0) delete memDismissed[id];
      }

      const mergedSeen = mergeCountMaps(
        serverSeen,
        mergeCountMaps(localSeen, memSeen)
      );
      const mergedDismissed = mergeCountMaps(
        serverDismissed,
        mergeCountMaps(localDismissed, memDismissed)
      );
      applyPrefs(mergedSeen, mergedDismissed);
      setItems(nextItems);

      if (
        mapsDiffer(mergedSeen, serverSeen) ||
        mapsDiffer(mergedDismissed, serverDismissed)
      ) {
        void fetch('/api/alarms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync',
            seen: mergedSeen,
            dismisses: mergedDismissed,
          }),
        }).catch(() => {});
      }
    } catch {
      /* 헤더는 알람 실패로 막지 않음 */
    }
  };

  useEffect(() => {
    if (!storageKey) return;
    const s = readLocalCountMap(seenStorageKey(storageKey));
    const d = readLocalCountMap(dismissedStorageKey(storageKey));
    seenRef.current = s;
    dismissedRef.current = d;
    setSeen(s);
    setDismissed(d);
  }, [storageKey]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const listItems = useMemo(
    () => items.filter((item) => !isAlarmDismissed(item, dismissed)),
    [items, dismissed]
  );

  const sortedItems = useMemo(() => {
    return [...listItems].sort((a, b) => {
      const fa = isAlarmFresh(a, seen) ? 1 : 0;
      const fb = isAlarmFresh(b, seen) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (Number(b.at) || 0) - (Number(a.at) || 0);
    });
  }, [listItems, seen]);

  const freshTotal = sortedItems.reduce(
    (sum, item) => sum + (isAlarmFresh(item, seen) ? item.count : 0),
    0
  );
  const hasFresh = freshTotal > 0;

  /** 확인(회색) — DB 저장 완료 후 이동 */
  const markSeen = async (item: AlarmItem) => {
    const stamp: AlarmStamp = stampOf(item);
    const next = mergeCountMaps(seenRef.current, { [item.id]: stamp });
    applyPrefs(next, dismissedRef.current);
    setBusyId(item.id);
    try {
      const res = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'seen',
          id: item.id,
          count: stamp.count,
          at: stamp.at,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[alarm seen]', err);
        alert(err.error || '알람 확인 저장에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data?.seen) {
        applyPrefs(
          mergeCountMaps(next, parseAlarmCountMap(data.seen)),
          dismissedRef.current
        );
      }
      setOpen(false);
      router.push(item.href);
    } catch {
      alert('서버와 통신할 수 없습니다. 확인 상태가 저장되지 않았을 수 있습니다.');
    } finally {
      setBusyId(null);
    }
  };

  /** ✕ 삭제 — DB 저장 완료까지 대기 */
  const dismissFromList = async (item: AlarmItem) => {
    const stamp: AlarmStamp = stampOf(item);
    const prevDismissed = dismissedRef.current;
    const next = mergeCountMaps(prevDismissed, { [item.id]: stamp });
    applyPrefs(seenRef.current, next);
    setBusyId(item.id);
    try {
      const res = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dismiss',
          id: item.id,
          count: stamp.count,
          at: stamp.at,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[alarm dismiss]', err);
        alert(err.error || '알람 삭제 저장에 실패했습니다. 다시 시도해 주세요.');
        applyPrefs(seenRef.current, prevDismissed);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data?.dismisses) {
        applyPrefs(
          seenRef.current,
          mergeCountMaps(next, parseAlarmCountMap(data.dismisses))
        );
      }
    } catch {
      alert('서버와 통신할 수 없습니다. 삭제가 저장되지 않았을 수 있습니다.');
      applyPrefs(seenRef.current, prevDismissed);
    } finally {
      setBusyId(null);
    }
  };

  const snoozeAlarm = async (item: AlarmItem) => {
    if (!canSnooze(item) || snoozingId) return;
    setSnoozingId(item.id);
    try {
      const res = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', id: item.id, days: ALARM_SNOOZE_DAYS }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '재알림 설정에 실패했습니다.');
        return;
      }
      setItems((prev) => prev.filter((row) => row.id !== item.id));
    } catch {
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setSnoozingId(null);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        title={
          hasFresh
            ? '확인하지 않은 알람이 있습니다.'
            : sortedItems.length > 0
              ? '확인한 알람입니다. ✕로 해당 줄을 삭제할 수 있습니다.'
              : '알람 없음'
        }
        className={`px-2.5 py-1 rounded-lg text-[11px] font-black tracking-tight border transition-colors ${
          hasFresh
            ? 'bg-amber-400/15 text-amber-200 border-amber-300/40 hover:bg-amber-400/25'
            : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
        }`}
        aria-expanded={open}
      >
        알람[{freshTotal}]
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[26rem] max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl z-[80] text-left">
          {sortedItems.length === 0 ? (
            <p className="px-4 py-6 text-[11px] font-bold text-slate-400 text-center">
              새 알람이 없습니다.
            </p>
          ) : (
            <ul className="py-1">
              {sortedItems.map((item) => {
                const fresh = isAlarmFresh(item, seen);
                const snoozable = canSnooze(item);
                const busy = busyId === item.id;
                return (
                  <li key={item.id} className="border-b border-slate-50 last:border-0">
                    <div className="flex items-stretch gap-1 px-2 py-1.5 hover:bg-slate-50">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void markSeen(item);
                        }}
                        className="min-w-0 flex-1 px-1.5 py-1.5 flex items-center justify-between gap-2 text-left disabled:opacity-60"
                      >
                        <span
                          className={`text-[11px] font-bold leading-snug ${
                            fresh ? 'text-slate-800' : 'text-slate-400'
                          }`}
                        >
                          {item.date ? (
                            <>
                              <span className={fresh ? 'text-slate-500' : 'text-slate-300'}>
                                {item.date}
                              </span>{' '}
                            </>
                          ) : null}
                          {item.label}
                        </span>
                        <span
                          className={`shrink-0 min-w-6 text-center text-[10px] font-black rounded-md px-1.5 py-0.5 border ${
                            fresh
                              ? 'text-amber-700 bg-amber-50 border-amber-200'
                              : 'text-slate-400 bg-slate-100 border-slate-200'
                          }`}
                        >
                          {item.count}
                        </span>
                      </button>
                      {snoozable && (
                        <button
                          type="button"
                          title={`${ALARM_SNOOZE_DAYS}일 후 다시 알림`}
                          disabled={snoozingId === item.id || busy}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void snoozeAlarm(item);
                          }}
                          className="shrink-0 self-center px-2 py-1 rounded-md text-[9px] font-black tracking-tight border border-slate-200 text-slate-500 bg-white hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                        >
                          {snoozingId === item.id ? '처리중…' : `재알림(${ALARM_SNOOZE_DAYS}일)`}
                        </button>
                      )}
                      <button
                        type="button"
                        title="이 알람 줄 삭제 (새 접수가 오기 전까지 재로그인해도 복구되지 않음)"
                        aria-label="알람 줄 삭제"
                        disabled={busy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void dismissFromList(item);
                        }}
                        className="group/dismiss shrink-0 self-center h-6 min-w-6 px-1 inline-flex items-center justify-center rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                      >
                        <span className="text-[11px] font-black leading-none group-hover/dismiss:hidden" aria-hidden>
                          {busy ? '…' : '✕'}
                        </span>
                        <span className="hidden group-hover/dismiss:inline text-[9px] font-black tracking-tight whitespace-nowrap">
                          삭제
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
