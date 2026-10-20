'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { getKrHolidaysForYear, KR_HOLIDAY_COLOR } from '@/utils/krHolidays';

type CalEvent = {
  id: string;
  title: string;
  note?: string | null;
  start_date: string;
  end_date?: string | null;
  color?: string | null;
  creator_name?: string | null;
  creator_dept?: string | null;
};

type DayCell = { dateStr: string; day: number };

type WeekSeg = {
  key: string;
  title: string;
  color: string;
  startCol: number;
  endCol: number;
  kind: 'holiday' | 'event';
  event?: CalEvent;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 파스텔·중간톤 혼합 (기본: 부드러운 블루) */
const COLORS = ['#7baaf7', '#81c995', '#f6bf26', '#e57373', '#78d9ec', '#b39ddb'];
const MAX_VISIBLE_LANES = 4;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseYmd(s: string) {
  const [y, m, d] = String(s || '')
    .split('-')
    .map((x) => Number(x));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function formatDotDate(s: string) {
  return String(s || '').replace(/-/g, '.') || '-';
}

function eventCoversDate(ev: CalEvent, dateStr: string) {
  const start = ev.start_date;
  const end = ev.end_date || ev.start_date;
  return start <= dateStr && dateStr <= end;
}

function segmentsOverlap(a: WeekSeg, b: WeekSeg) {
  return !(a.endCol < b.startCol || a.startCol > b.endCol);
}

/** 주(7칸) 단위로 공휴일·일정을 레인에 배치 (구글캘린더식 연속 바) */
function layoutWeekLanes(
  week: Array<DayCell | null>,
  events: CalEvent[],
  holidays: Map<string, string>
): WeekSeg[][] {
  const items: WeekSeg[] = [];

  week.forEach((cell, col) => {
    if (!cell) return;
    const name = holidays.get(cell.dateStr);
    if (name) {
      items.push({
        key: `h-${cell.dateStr}`,
        title: name,
        color: KR_HOLIDAY_COLOR,
        startCol: col,
        endCol: col,
        kind: 'holiday',
      });
    }
  });

  for (const ev of events) {
    const evStart = ev.start_date;
    const evEnd = ev.end_date || ev.start_date;
    let startCol = -1;
    let endCol = -1;
    for (let c = 0; c < 7; c++) {
      const cell = week[c];
      if (!cell) continue;
      if (cell.dateStr >= evStart && cell.dateStr <= evEnd) {
        if (startCol < 0) startCol = c;
        endCol = c;
      }
    }
    if (startCol < 0) continue;
    items.push({
      key: `e-${ev.id}-${week[startCol]?.dateStr || startCol}`,
      title: ev.title,
      color: ev.color || COLORS[0],
      startCol,
      endCol,
      kind: 'event',
      event: ev,
    });
  }

  items.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const da = a.endCol - a.startCol;
    const db = b.endCol - b.startCol;
    if (da !== db) return db - da;
    if (a.kind !== b.kind) return a.kind === 'holiday' ? -1 : 1;
    return a.title.localeCompare(b.title, 'ko');
  });

  const lanes: WeekSeg[][] = [];
  for (const item of items) {
    let placed = false;
    for (const lane of lanes) {
      if (!lane.some((x) => segmentsOverlap(x, item))) {
        lane.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([item]);
  }
  return lanes;
}

function renderLaneRow(
  lane: WeekSeg[],
  onSegClick: (seg: WeekSeg) => void
) {
  const sorted = [...lane].sort((a, b) => a.startCol - b.startCol);
  const nodes: React.ReactNode[] = [];
  let col = 0;
  for (const seg of sorted) {
    while (col < seg.startCol) {
      nodes.push(<div key={`pad-${col}`} className="min-w-0" />);
      col += 1;
    }
    const span = seg.endCol - seg.startCol + 1;
    nodes.push(
      <button
        key={seg.key}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSegClick(seg);
        }}
        title={seg.title}
        className={`min-w-0 h-[17px] truncate rounded-sm px-1.5 text-[11px] font-normal text-white text-left leading-[17px] hover:opacity-90 ${
          seg.kind === 'holiday' ? 'cursor-default' : ''
        }`}
        style={{
          gridColumn: `span ${span}`,
          backgroundColor: seg.color,
        }}
      >
        {seg.title}
      </button>
    );
    col = seg.endCol + 1;
  }
  return nodes;
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

type ModalState =
  | null
  | {
      mode: 'create' | 'edit';
      id?: string;
      title: string;
      note: string;
      start_date: string;
      end_date: string;
      color: string;
    };

export default function DeptSharedCalendar() {
  const { year: nowY, month: nowM } = getKSTNowYearMonth();
  const today = getKSTDateString() || ymd(nowY, nowM, 1);

  const [viewYear, setViewYear] = useState(nowY);
  const [viewMonth, setViewMonth] = useState(nowM);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [unitName, setUnitName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [modal, setModal] = useState<ModalState>(null);

  const monthRange = useMemo(() => {
    const from = ymd(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth, 0).getDate();
    const to = ymd(viewYear, viewMonth, lastDay);
    return { from, to, lastDay };
  }, [viewYear, viewMonth]);

  const holidays = useMemo(() => getKrHolidaysForYear(viewYear), [viewYear]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/marketing/dept-calendar?from=${monthRange.from}&to=${monthRange.to}&t=${Date.now()}`
      );
      if (!res.ok) {
        setEvents([]);
        setError(await readApiError(res, '일정을 불러오지 못했습니다.'));
        return;
      }
      const data = await res.json();
      setUnitName(String(data.unitName || '').trim());
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setEvents([]);
      setError('네트워크 오류로 일정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [monthRange.from, monthRange.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const cells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
    const days: Array<DayCell | null> = [];
    for (let i = 0; i < firstDow; i++) days.push(null);
    for (let d = 1; d <= monthRange.lastDay; d++) {
      days.push({ dateStr: ymd(viewYear, viewMonth, d), day: d });
    }
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewYear, viewMonth, monthRange.lastDay]);

  const weeks = useMemo(() => {
    const rows: Array<Array<DayCell | null>> = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [cells]);

  const weekLayouts = useMemo(
    () => weeks.map((week) => layoutWeekLanes(week, events, holidays)),
    [weeks, events, holidays]
  );

  const selectedDayEvents = useMemo(
    () => events.filter((ev) => eventCoversDate(ev, selectedDate)),
    [events, selectedDate]
  );

  const selectedHoliday = holidays.get(selectedDate) || null;

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
  };

  const openCreate = (dateStr: string) => {
    setSelectedDate(dateStr);
    setModal({
      mode: 'create',
      title: '',
      note: '',
      start_date: dateStr,
      end_date: dateStr,
      color: COLORS[0],
    });
  };

  const openEdit = (ev: CalEvent) => {
    setSelectedDate(ev.start_date);
    setModal({
      mode: 'edit',
      id: ev.id,
      title: ev.title || '',
      note: String(ev.note || ''),
      start_date: ev.start_date,
      end_date: ev.end_date || ev.start_date,
      color: ev.color || COLORS[0],
    });
  };

  const onSegClick = (seg: WeekSeg, week: Array<DayCell | null>) => {
    const cell = week[seg.startCol];
    if (cell) setSelectedDate(cell.dateStr);
    if (seg.kind === 'event' && seg.event) openEdit(seg.event);
  };

  const saveModal = async () => {
    if (!modal) return;
    const title = modal.title.trim();
    if (!title) return alert('제목을 입력해 주세요.');
    if (!parseYmd(modal.start_date)) return alert('시작일을 확인해 주세요.');
    setBusy(true);
    try {
      const payload = {
        id: modal.id,
        title,
        note: modal.note.trim(),
        start_date: modal.start_date,
        end_date: modal.end_date || modal.start_date,
        color: modal.color,
      };
      const res = await fetch('/api/marketing/dept-calendar', {
        method: modal.mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        alert(await readApiError(res, '저장 실패'));
        return;
      }
      setSelectedDate(payload.start_date);
      setModal(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async () => {
    if (!modal?.id) return;
    if (!confirm('이 일정을 삭제할까요?\n(같은 소속 전원 달력에서 사라집니다.)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketing/dept-calendar?id=${encodeURIComponent(modal.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        alert(await readApiError(res, '삭제 실패'));
        return;
      }
      setModal(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {/* 상단 KPI 3열(gap-3)과 동일: 달력 2칸 + 디테일 1칸 */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
      <div className="md:col-span-2 min-w-0 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
            Shared Team Calendar
          </p>
          <div className="mt-0.5 flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 shrink-0 truncate">
              공유 일정{unitName ? ` (${unitName})` : ''}
            </h2>
            <p className="text-[10px] font-normal text-slate-400 truncate min-w-0">
              해당 소속 부서원만 보는 공유 일정표 · 상위 본부·하위 소속 제외
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 font-normal hover:bg-slate-50 text-sm"
            aria-label="이전 달"
          >
            ‹
          </button>
          <p className="text-xs font-medium text-slate-800 tabular-nums min-w-[5.5rem] text-center">
            {viewYear}.{pad2(viewMonth)}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 font-normal hover:bg-slate-50 text-sm"
            aria-label="다음 달"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => {
              setViewYear(nowY);
              setViewMonth(nowM);
              setSelectedDate(today);
            }}
            className="h-7 px-2 rounded-md bg-slate-100 text-slate-700 text-[10px] font-medium hover:bg-slate-200"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => openCreate(selectedDate || today)}
            className="h-7 px-2.5 rounded-md bg-indigo-600 text-white text-[10px] font-medium hover:bg-indigo-700"
          >
            + 일정
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-normal text-amber-800">
          {error}
        </div>
      )}

      <div className="p-3 flex-1 min-w-0">
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-200">
            <div className="grid grid-cols-7 gap-px">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={`bg-slate-50 px-1 py-1.5 text-center text-[11px] font-medium ${
                    i === 0 ? 'text-rose-500' : i === 6 ? 'text-indigo-500' : 'text-slate-500'
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => {
              const lanes = weekLayouts[wi] || [];
              const visibleLanes = lanes.slice(0, MAX_VISIBLE_LANES);
              const hiddenLanes = lanes.slice(MAX_VISIBLE_LANES);
              return (
                <div key={`week-${wi}`} className="border-t border-slate-200 bg-white">
                  <div className="grid grid-cols-7 gap-px bg-slate-100">
                    {week.map((cell, col) => {
                      if (!cell) {
                        return (
                          <div
                            key={`e-${wi}-${col}`}
                            className="bg-slate-50/80 min-h-[22px] px-1 pt-0.5"
                          />
                        );
                      }
                      const isToday = cell.dateStr === today;
                      const isSelected = cell.dateStr === selectedDate;
                      const isHoliday = holidays.has(cell.dateStr);
                      const dow = col;
                      return (
                        <div
                          key={cell.dateStr}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedDate(cell.dateStr)}
                          onDoubleClick={() => openCreate(cell.dateStr)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setSelectedDate(cell.dateStr);
                          }}
                          className={`min-h-[22px] px-1 pt-0.5 text-left cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-50/90'
                              : isToday
                                ? 'bg-indigo-50/40'
                                : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-0.5">
                            <span
                              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[12px] font-normal tabular-nums ${
                                isToday
                                  ? 'bg-indigo-600 text-white'
                                  : isHoliday || dow === 0
                                    ? 'text-rose-500'
                                    : dow === 6
                                      ? 'text-indigo-500'
                                      : 'text-slate-700'
                              }`}
                            >
                              {cell.day}
                            </span>
                            <button
                              type="button"
                              title="새 일정"
                              onClick={(e) => {
                                e.stopPropagation();
                                openCreate(cell.dateStr);
                              }}
                              className="w-4 h-4 rounded text-[10px] font-normal text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 leading-none"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="relative grid grid-cols-7 gap-px bg-slate-100"
                    style={{ minHeight: Math.max(56, visibleLanes.length * 19 + 8) }}
                  >
                    {week.map((cell, col) => {
                      const isSelected = cell?.dateStr === selectedDate;
                      const isToday = cell?.dateStr === today;
                      return (
                        <div
                          key={`bg-${wi}-${col}`}
                          role={cell ? 'button' : undefined}
                          tabIndex={cell ? 0 : undefined}
                          onClick={() => cell && setSelectedDate(cell.dateStr)}
                          onDoubleClick={() => cell && openCreate(cell.dateStr)}
                          className={`min-h-full ${
                            !cell
                              ? 'bg-slate-50/80'
                              : isSelected
                                ? 'bg-indigo-50/90 ring-2 ring-inset ring-indigo-500'
                                : isToday
                                  ? 'bg-indigo-50/30 ring-1 ring-inset ring-indigo-200'
                                  : 'bg-white hover:bg-slate-50 cursor-pointer'
                          }`}
                        />
                      );
                    })}

                    <div className="absolute inset-0 pointer-events-none flex flex-col gap-0.5 py-0.5">
                      {visibleLanes.map((lane, li) => (
                        <div
                          key={`lane-${wi}-${li}`}
                          className="grid grid-cols-7 gap-x-0.5 px-0.5 pointer-events-auto"
                        >
                          {renderLaneRow(lane, (seg) => onSegClick(seg, week))}
                        </div>
                      ))}
                      {hiddenLanes.length > 0 && (
                        <div className="grid grid-cols-7 gap-x-0.5 px-0.5 pointer-events-auto">
                          {week.map((cell, col) => {
                            if (!cell) return <div key={`more-e-${col}`} />;
                            const more = hiddenLanes.filter((lane) =>
                              lane.some((s) => s.startCol <= col && col <= s.endCol)
                            ).length;
                            if (more <= 0) return <div key={`more-${col}`} />;
                            return (
                              <button
                                key={`more-${col}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDate(cell.dateStr);
                                }}
                                className="text-left text-[11px] font-normal text-indigo-500 px-0.5 hover:underline truncate"
                              >
                                +{more}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {loading && (
            <p className="text-center text-[11px] font-normal text-slate-400 mt-2">일정 불러오는 중…</p>
          )}
      </div>
      </div>

      <div className="md:col-span-1 min-w-0 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[280px]">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none">
                Detail
              </p>
              <p className="text-[13px] font-medium text-slate-900 tabular-nums mt-0.5 leading-tight">
                {formatDotDate(selectedDate)}
              </p>
              {selectedHoliday ? (
                <p className="text-[11px] font-normal text-rose-500 mt-0.5 truncate">
                  {selectedHoliday}
                </p>
              ) : null}
            </div>
            <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded shrink-0">
              {selectedDayEvents.length}건
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {selectedHoliday && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: KR_HOLIDAY_COLOR }}
                  />
                  <span className="text-[12px] font-normal text-rose-700 truncate">
                    {selectedHoliday}
                  </span>
                  <span className="text-[10px] font-normal text-rose-500 shrink-0">공휴일</span>
                </div>
              </div>
            )}

            {selectedDayEvents.length === 0 && !selectedHoliday ? (
              <div className="h-full min-h-[160px] flex flex-col items-center justify-center gap-2 px-2">
                <p className="text-[11px] font-normal text-slate-400 text-center leading-snug">
                  등록된 일정이 없습니다
                </p>
                <button
                  type="button"
                  onClick={() => openCreate(selectedDate)}
                  className="h-7 px-2.5 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700"
                >
                  + 새 일정
                </button>
              </div>
            ) : selectedDayEvents.length === 0 ? (
              <div className="px-1 py-2">
                <button
                  type="button"
                  onClick={() => openCreate(selectedDate)}
                  className="w-full h-8 rounded-md border border-dashed border-indigo-200 text-indigo-600 text-[11px] font-medium hover:bg-indigo-50"
                >
                  + 이 날짜에 일정 추가
                </button>
              </div>
            ) : (
              selectedDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEdit(ev)}
                  className="w-full text-left rounded-md border border-slate-200 bg-white px-2 py-1.5 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: ev.color || COLORS[0] }}
                    />
                    <span className="text-[12px] font-normal text-slate-800 truncate min-w-0 flex-1 leading-tight">
                      {ev.title}
                    </span>
                    <span
                      className="text-[11px] font-normal text-slate-400 shrink-0 truncate max-w-[3.8rem] text-right leading-tight"
                      title={ev.creator_name || ''}
                    >
                      {ev.creator_name || '-'}
                    </span>
                  </div>
                  {ev.note ? (
                    <p className="text-[11px] font-normal text-slate-400 mt-0.5 truncate pl-3 leading-tight">
                      {ev.note}
                    </p>
                  ) : null}
                  {(ev.end_date || ev.start_date) !== ev.start_date && (
                    <p className="text-[10px] font-normal text-slate-300 mt-0.5 pl-3 tabular-nums">
                      {formatDotDate(ev.start_date)} ~ {formatDotDate(ev.end_date || ev.start_date)}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>

          {selectedDayEvents.length > 0 && (
            <div className="p-2 border-t border-slate-100 bg-white shrink-0">
              <button
                type="button"
                onClick={() => openCreate(selectedDate)}
                className="w-full h-8 rounded-md border border-dashed border-indigo-200 text-indigo-600 text-[11px] font-medium hover:bg-indigo-50"
              >
                + 이 날짜에 일정 추가
              </button>
            </div>
          )}
      </div>
    </div>

      {modal && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {modal.mode === 'create' ? '새 일정 등록' : '일정 수정'}
              </h3>
              <p className="text-[11px] font-normal text-slate-500 mt-0.5">
                {unitName || '소속'} 전원에게 바로 공유됩니다
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">제목</label>
                <input
                  type="text"
                  value={modal.title}
                  maxLength={120}
                  onChange={(e) => setModal({ ...modal, title: e.target.value })}
                  placeholder="예: 고객사 방문, 기념품 준비"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-slate-500 block mb-1">시작일</label>
                  <input
                    type="date"
                    value={modal.start_date}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        start_date: e.target.value,
                        end_date:
                          modal.end_date < e.target.value ? e.target.value : modal.end_date,
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-500 block mb-1">종료일</label>
                  <input
                    type="date"
                    value={modal.end_date}
                    min={modal.start_date}
                    onChange={(e) => setModal({ ...modal, end_date: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">메모</label>
                <textarea
                  value={modal.note}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setModal({ ...modal, note: e.target.value })}
                  placeholder="상세 내용 (선택)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1.5">색상</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setModal({ ...modal, color: c })}
                      className={`w-7 h-7 rounded-full border-2 ${
                        modal.color === c ? 'border-slate-800 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-between pt-1">
                {modal.mode === 'edit' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteEvent()}
                    className="px-3.5 py-2 rounded-xl text-[11px] font-medium bg-red-50 text-red-600 border border-red-100 hover:bg-red-500 hover:text-white disabled:opacity-40"
                  >
                    삭제
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                    className="px-3.5 py-2 rounded-xl text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    disabled={busy || !modal.title.trim()}
                    onClick={() => void saveModal()}
                    className="px-3.5 py-2 rounded-xl text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
