'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { getKrHolidaysForYear, KR_HOLIDAY_COLOR } from '@/utils/krHolidays';

type CalEvent = {
  id: string;
  title: string;
  note?: string | null;
  location?: string | null;
  time_text?: string | null;
  attendees?: string | null;
  start_date: string;
  end_date?: string | null;
  color?: string | null;
  color_purpose_id?: string | null;
  creator_name?: string | null;
  creator_dept?: string | null;
};

type ColorPurpose = {
  id: string;
  label: string;
  color: string;
  updated_by_name?: string | null;
};

type DayCell = { dateStr: string; day: number };

type WeekSeg = {
  key: string;
  title: string;
  color: string;
  startCol: number;
  endCol: number;
  event: CalEvent;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** 앞: 파스텔 · 뒤: 쨍한 톤 (연한 로즈 #fecdd3 포함) */
const COLORS = [
  '#7baaf7',
  '#81c995',
  '#f6bf26',
  '#fecdd3',
  '#78d9ec',
  '#b39ddb',
  '#e57373',
  '#ff6d00',
  '#aa00ff',
  '#00c853',
  '#304ffe',
];
const MAX_VISIBLE_LANES = 4;
const LANE_H = 14;

/** 연한 띠에도 읽히도록 배경 밝기에 따라 글자색 */
function contrastText(bg: string): string {
  const h = String(bg || '')
    .replace('#', '')
    .trim();
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff';
  const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return y > 0.62 ? '#0f172a' : '#ffffff';
}

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

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function eventCoversDate(ev: CalEvent, dateStr: string) {
  const start = ev.start_date;
  const end = ev.end_date || ev.start_date;
  return start <= dateStr && dateStr <= end;
}

/** 월간 일정 인쇄/다운로드용 HTML (한 장 기준 일별 Detail 포맷) */
function buildMonthPrintHtml(opts: {
  year: number;
  month: number;
  unitName: string;
  events: CalEvent[];
  holidays: Map<string, string>;
}) {
  const { year, month, unitName, events, holidays } = opts;
  const lastDay = new Date(year, month, 0).getDate();
  const title = `${year}.${pad2(month)}`;
  const unitLabel = unitName ? ` · ${escapeHtml(unitName)}` : '';

  const dayRows: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = ymd(year, month, d);
    const dow = WEEKDAYS[new Date(year, month - 1, d).getDay()];
    const dayLabel = `${d}(${dow})`;
    const holiday = holidays.get(dateStr);
    const dayEvents = events.filter((ev) => eventCoversDate(ev, dateStr));

    const detailRows: string[] = [];
    if (holiday) {
      detailRows.push(`
        <tr>
          <td>${escapeHtml(holiday)}</td>
          <td>—</td>
          <td>종일</td>
          <td>공휴일</td>
        </tr>`);
    }
    if (dayEvents.length === 0 && !holiday) {
      detailRows.push(`
        <tr class="empty">
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>`);
    } else {
      for (const ev of dayEvents) {
        detailRows.push(`
          <tr>
            <td>${escapeHtml(ev.title || '')}</td>
            <td>${escapeHtml(String(ev.location || '').trim() || '—')}</td>
            <td>${escapeHtml(String(ev.time_text || '').trim() || '—')}</td>
            <td>${escapeHtml(String(ev.attendees || '').trim() || '—')}</td>
          </tr>`);
      }
    }

    const isWeekend = dow === '일' || dow === '토';
    dayRows.push(`
      <tr class="day-row${isWeekend ? ' weekend' : ''}${holiday ? ' holiday' : ''}">
        <td class="day-col">${escapeHtml(dayLabel)}</td>
        <td class="detail-col">
          <table class="detail-table">
            <thead>
              <tr>
                <th>내용</th>
                <th>위치</th>
                <th>시간</th>
                <th>참석자</th>
              </tr>
            </thead>
            <tbody>${detailRows.join('')}</tbody>
          </table>
        </td>
      </tr>`);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>공유 일정 ${title}</title>
  <style>
    @page { size: A4; margin: 12mm 10mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      color: #1e293b;
      font-size: 10px;
      margin: 0;
      padding: 0;
    }
    .header { margin-bottom: 10px; border-bottom: 2px solid #334155; padding-bottom: 8px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.02em; }
    .header p { margin: 4px 0 0; font-size: 11px; color: #64748b; }
    table.month { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.month > tbody > tr.day-row > td {
      border: 1px solid #cbd5e1;
      vertical-align: top;
      padding: 0;
    }
    td.day-col {
      width: 48px;
      text-align: center;
      font-weight: 700;
      font-size: 11px;
      padding: 6px 4px !important;
      background: #f8fafc;
      white-space: nowrap;
    }
    tr.weekend td.day-col { color: #4f46e5; }
    tr.holiday td.day-col { color: #e11d48; background: #fff1f2; }
    td.detail-col { padding: 0 !important; }
    table.detail-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.detail-table th {
      background: #f1f5f9;
      font-size: 9px;
      font-weight: 600;
      color: #64748b;
      text-align: left;
      padding: 3px 6px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
    }
    table.detail-table th:last-child { border-right: none; }
    table.detail-table th:nth-child(1) { width: 38%; }
    table.detail-table th:nth-child(2) { width: 22%; }
    table.detail-table th:nth-child(3) { width: 14%; }
    table.detail-table th:nth-child(4) { width: 26%; }
    table.detail-table td {
      padding: 4px 6px;
      border-bottom: 1px solid #f1f5f9;
      border-right: 1px solid #f1f5f9;
      word-break: break-word;
      min-height: 18px;
    }
    table.detail-table td:last-child { border-right: none; }
    table.detail-table tr:last-child td { border-bottom: none; }
    table.detail-table tr.empty td { height: 22px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <p>공유 일정${unitLabel}</p>
  </div>
  <table class="month">
    <tbody>
      ${dayRows.join('')}
    </tbody>
  </table>
</body>
</html>`;
}

/** 팝업 없이 숨은 iframe으로 인쇄 대화상자 열기 */
function openMonthPrint(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'schedule-print');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    document.body.removeChild(iframe);
    alert('인쇄 창을 열 수 없습니다.');
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      if (iframe.parentNode) document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      alert('인쇄를 실행할 수 없습니다.');
    } finally {
      // 인쇄 대화상자 닫힌 뒤 iframe 제거
      setTimeout(cleanup, 1500);
    }
  };

  // 문서 로드 후 인쇄 (팝업 차단과 무관)
  if (doc.readyState === 'complete') {
    setTimeout(triggerPrint, 100);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 100);
    setTimeout(triggerPrint, 400);
  }
}

function segmentsOverlap(a: WeekSeg, b: WeekSeg) {
  return !(a.endCol < b.startCol || a.startCol > b.endCol);
}

/** 주(7칸) 단위로 일정을 레인에 배치 (휴일은 띠 없이 날짜 아래 텍스트) */
function layoutWeekLanes(
  week: Array<DayCell | null>,
  events: CalEvent[]
): WeekSeg[][] {
  const items: WeekSeg[] = [];

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
      event: ev,
    });
  }

  items.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const da = a.endCol - a.startCol;
    const db = b.endCol - b.startCol;
    if (da !== db) return db - da;
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
        className="min-w-0 truncate rounded-sm px-1 text-[10px] font-medium text-left hover:opacity-90"
        style={{
          gridColumn: `span ${span}`,
          height: LANE_H,
          lineHeight: `${LANE_H}px`,
          backgroundColor: seg.color,
          color: contrastText(seg.color),
        }}
      >
        {seg.title}
      </button>
    );
    col = seg.endCol + 1;
  }
  while (col < 7) {
    nodes.push(<div key={`pad-end-${col}`} className="min-w-0" />);
    col += 1;
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
      location: string;
      time_text: string;
      attendees: string;
      start_date: string;
      end_date: string;
      color: string;
      /** null = 개인 설정 */
      color_purpose_id: string | null;
    };

type PurposeEditState =
  | null
  | {
      mode: 'create' | 'edit';
      id?: string;
      label: string;
      color: string;
    };

export default function DeptSharedCalendar() {
  const { year: nowY, month: nowM } = getKSTNowYearMonth();
  const today = getKSTDateString() || ymd(nowY, nowM, 1);

  const [viewYear, setViewYear] = useState(nowY);
  const [viewMonth, setViewMonth] = useState(nowM);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [unitName, setUnitName] = useState('');
  const [purposes, setPurposes] = useState<ColorPurpose[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [modal, setModal] = useState<ModalState>(null);
  const [purposeEdit, setPurposeEdit] = useState<PurposeEditState>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const monthRange = useMemo(() => {
    const from = ymd(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth, 0).getDate();
    const to = ymd(viewYear, viewMonth, lastDay);
    return { from, to, lastDay };
  }, [viewYear, viewMonth]);

  const holidays = useMemo(() => getKrHolidaysForYear(viewYear), [viewYear]);

  const loadPurposes = useCallback(async () => {
    try {
      const res = await fetch(`/api/schedule/dept-color-purposes?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setPurposes(Array.isArray(data.purposes) ? data.purposes : []);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/schedule/dept-calendar?from=${monthRange.from}&to=${monthRange.to}&t=${Date.now()}`
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

  useEffect(() => {
    void loadPurposes();
  }, [loadPurposes]);

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
    () => weeks.map((week) => layoutWeekLanes(week, events)),
    [weeks, events]
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
    const firstPurpose = purposes[0];
    setModal({
      mode: 'create',
      title: '',
      location: '',
      time_text: '',
      attendees: '',
      start_date: dateStr,
      end_date: dateStr,
      color: firstPurpose?.color || COLORS[0],
      color_purpose_id: firstPurpose?.id || null,
    });
  };

  const openEdit = (ev: CalEvent) => {
    setSelectedDate(ev.start_date);
    const purposeId = ev.color_purpose_id || null;
    const purpose = purposeId ? purposes.find((p) => p.id === purposeId) : null;
    setModal({
      mode: 'edit',
      id: ev.id,
      title: ev.title || '',
      location: String(ev.location || ''),
      time_text: String(ev.time_text || ''),
      attendees: String(ev.attendees || ''),
      start_date: ev.start_date,
      end_date: ev.end_date || ev.start_date,
      color: purpose?.color || ev.color || COLORS[0],
      color_purpose_id: purposeId,
    });
  };

  const onSegClick = (seg: WeekSeg, week: Array<DayCell | null>) => {
    const cell = week[seg.startCol];
    if (cell) setSelectedDate(cell.dateStr);
    if (seg.event) openEdit(seg.event);
  };

  const saveModal = async () => {
    if (!modal) return;
    const title = modal.title.trim();
    if (!title) return alert('내용을 입력해 주세요.');
    if (!parseYmd(modal.start_date)) return alert('시작일을 확인해 주세요.');
    setBusy(true);
    try {
      const payload = {
        id: modal.id,
        title,
        location: modal.location.trim(),
        time_text: modal.time_text.trim(),
        attendees: modal.attendees.trim(),
        start_date: modal.start_date,
        end_date: modal.end_date || modal.start_date,
        color: modal.color,
        color_purpose_id: modal.color_purpose_id,
      };
      const res = await fetch('/api/schedule/dept-calendar', {
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
      const res = await fetch(`/api/schedule/dept-calendar?id=${encodeURIComponent(modal.id)}`, {
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

  const savePurposeEdit = async () => {
    if (!purposeEdit) return;
    const label = purposeEdit.label.trim();
    if (!label) return alert('용도명을 입력해 주세요.');
    setBusy(true);
    try {
      const res = await fetch('/api/schedule/dept-color-purposes', {
        method: purposeEdit.mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: purposeEdit.id,
          label,
          color: purposeEdit.color,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(String(data.error || '용도 저장 실패'));
        return;
      }
      if (data.colorChanged && Number(data.updatedEvents || 0) > 0) {
        alert(
          `「${label}」 색상이 변경되어 연결된 일정 ${data.updatedEvents}건이 일괄 반영되었습니다.`
        );
      }
      setPurposeEdit(null);
      await Promise.all([loadPurposes(), load()]);
      if (modal?.color_purpose_id && purposeEdit.id === modal.color_purpose_id && data.color) {
        setModal({ ...modal, color: String(data.color) });
      }
    } finally {
      setBusy(false);
    }
  };

  const deletePurpose = async (p: ColorPurpose) => {
    if (
      !confirm(
        `「${p.label}」 용도를 삭제할까요?\n이미 등록된 일정 색상 값은 유지되고, 공용 연결만 해제됩니다.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/schedule/dept-color-purposes?id=${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        alert(await readApiError(res, '용도 삭제 실패'));
        return;
      }
      if (modal?.color_purpose_id === p.id) {
        setModal({ ...modal, color_purpose_id: null });
      }
      await loadPurposes();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {/* 좌: 달력 / 우: Detail — 1:1 */}
    <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
      <div className="min-w-0 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
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
            title={`${viewYear}.${pad2(viewMonth)} 일정 인쇄·다운로드`}
            onClick={() => {
              const html = buildMonthPrintHtml({
                year: viewYear,
                month: viewMonth,
                unitName,
                events,
                holidays,
              });
              openMonthPrint(html);
            }}
            className="h-7 px-2.5 rounded-md border border-slate-200 bg-white text-slate-700 text-[10px] font-medium hover:bg-slate-50 hover:border-slate-300"
          >
            ⬇ 다운
          </button>
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
            onClick={() => setManageOpen(true)}
            className="h-7 px-2.5 rounded-md border border-slate-200 bg-white text-slate-700 text-[10px] font-medium hover:bg-slate-50"
          >
            색상 관리
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

      <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[10px] font-medium text-slate-500 shrink-0">부서 공용</span>
        {purposes.length === 0 ? (
          <span className="text-[11px] text-slate-400">용도를 추가해 팀 색상을 맞춰 보세요</span>
        ) : (
          purposes.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-700"
              title={p.updated_by_name ? `최근 변경: ${p.updated_by_name}` : undefined}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              {p.label}
            </span>
          ))
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-normal text-amber-800">
          {error}
        </div>
      )}

      <div className="p-3.5 flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-200 flex-1 min-h-0 flex flex-col">
            <div className="grid grid-cols-7 gap-px shrink-0">
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

            <div className="flex-1 min-h-0 flex flex-col">
            {weeks.map((week, wi) => {
              const lanes = weekLayouts[wi] || [];
              const visibleLanes = lanes.slice(0, MAX_VISIBLE_LANES);
              const hiddenLanes = lanes.slice(MAX_VISIBLE_LANES);
              return (
                <div key={`week-${wi}`} className="border-t border-slate-200 bg-white flex-1 min-h-0 flex flex-col">
                  <div className="grid grid-cols-7 gap-px bg-slate-100 shrink-0">
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
                    className="relative grid grid-cols-7 gap-px bg-slate-100 flex-1 min-h-[64px]"
                    style={{
                      minHeight: Math.max(56, visibleLanes.length * (LANE_H + 2) + 16),
                    }}
                  >
                    {week.map((cell, col) => {
                      const isSelected = cell?.dateStr === selectedDate;
                      const isTodayCell = cell?.dateStr === today;
                      const holidayName = cell
                        ? holidays.get(cell.dateStr) || null
                        : null;
                      return (
                        <div
                          key={`bg-${wi}-${col}`}
                          role={cell ? 'button' : undefined}
                          tabIndex={cell ? 0 : undefined}
                          onClick={() => cell && setSelectedDate(cell.dateStr)}
                          onDoubleClick={() => cell && openCreate(cell.dateStr)}
                          className={`min-h-full px-0.5 pt-0.5 ${
                            !cell
                              ? 'bg-slate-50/80'
                              : isSelected
                                ? 'bg-indigo-50/90 ring-2 ring-inset ring-indigo-500'
                                : isTodayCell
                                  ? 'bg-indigo-50/30 ring-1 ring-inset ring-indigo-200'
                                  : 'bg-white hover:bg-slate-50 cursor-pointer'
                          }`}
                        >
                          {holidayName ? (
                            <p
                              className="truncate text-[9px] font-medium leading-tight"
                              style={{ color: KR_HOLIDAY_COLOR }}
                              title={holidayName}
                            >
                              {holidayName}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}

                    <div className="absolute inset-0 pointer-events-none flex flex-col gap-px py-0.5 pt-3.5">
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
          </div>
          {loading && (
            <p className="text-center text-[11px] font-normal text-slate-400 mt-2 shrink-0">일정 불러오는 중…</p>
          )}
      </div>
      </div>

      {/* Detail — 내용 / 위치 / 시간 / 참석자 가로 칸 */}
      <div className="min-w-0 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="px-3 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest leading-none">
              Detail
            </p>
            <p className="text-[13px] font-medium text-slate-900 tabular-nums leading-tight">
              {formatDotDate(selectedDate)}
            </p>
            {selectedHoliday ? (
              <p className="text-[11px] font-normal text-rose-500 truncate">{selectedHoliday}</p>
            ) : null}
            <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded shrink-0">
              {selectedDayEvents.length}건
            </span>
          </div>
          <button
            type="button"
            onClick={() => openCreate(selectedDate)}
            className="h-7 px-2.5 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700 shrink-0"
          >
            + 일정
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="min-w-[420px]">
            <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.95fr)_minmax(0,0.55fr)_minmax(0,1.3fr)] gap-0 sticky top-0 z-10 border-b border-slate-100 bg-slate-50 text-[10px] font-medium text-slate-500 tracking-tight">
              <div className="px-2 py-2">내용</div>
              <div className="px-2 py-2 border-l border-slate-100">위치</div>
              <div className="px-2 py-2 border-l border-slate-100">시간</div>
              <div className="px-2 py-2 border-l border-slate-100">참석자</div>
            </div>

            {selectedHoliday && (
              <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.95fr)_minmax(0,0.55fr)_minmax(0,1.3fr)] gap-0 border-b border-rose-100 bg-rose-50/60 text-[11px]">
                <div className="px-2 py-2 flex items-center gap-1 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: KR_HOLIDAY_COLOR }}
                  />
                  <span className="font-medium text-rose-700 truncate">{selectedHoliday}</span>
                </div>
                <div className="px-2 py-2 border-l border-rose-100 text-rose-400">—</div>
                <div className="px-2 py-2 border-l border-rose-100 text-rose-400">종일</div>
                <div className="px-2 py-2 border-l border-rose-100 text-rose-400">공휴일</div>
              </div>
            )}

            {selectedDayEvents.length === 0 && !selectedHoliday ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[12px] font-normal text-slate-400 mb-3">
                  등록된 일정이 없습니다
                </p>
                <button
                  type="button"
                  onClick={() => openCreate(selectedDate)}
                  className="h-8 px-3 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700"
                >
                  + 새 일정
                </button>
              </div>
            ) : (
              selectedDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEdit(ev)}
                  className="w-full grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.95fr)_minmax(0,0.55fr)_minmax(0,1.3fr)] gap-0 border-b border-slate-100 last:border-b-0 text-left hover:bg-indigo-50/40 transition-colors text-[11px]"
                >
                  <div className="px-2 py-2 flex items-center gap-1 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: ev.color || COLORS[0] }}
                    />
                    <span className="font-medium text-slate-800 truncate" title={ev.title}>
                      {ev.title || '—'}
                    </span>
                  </div>
                  <div
                    className="px-2 py-2 border-l border-slate-100 text-slate-600 truncate"
                    title={ev.location || ''}
                  >
                    {ev.location?.trim() || '—'}
                  </div>
                  <div
                    className="px-2 py-2 border-l border-slate-100 text-slate-600 truncate tabular-nums"
                    title={ev.time_text || ''}
                  >
                    {ev.time_text?.trim() || '—'}
                  </div>
                  <div
                    className="px-2 py-2 border-l border-slate-100 text-slate-600 truncate"
                    title={ev.attendees || ''}
                  >
                    {ev.attendees?.trim() || '—'}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>

      {modal && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
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
                <label className="text-[10px] font-medium text-slate-500 block mb-1">내용</label>
                <input
                  type="text"
                  value={modal.title}
                  maxLength={120}
                  onChange={(e) => setModal({ ...modal, title: e.target.value })}
                  placeholder="예: 고객사 미팅, 현장 점검"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">위치</label>
                <input
                  type="text"
                  value={modal.location}
                  maxLength={200}
                  onChange={(e) => setModal({ ...modal, location: e.target.value })}
                  placeholder="예: 본사 회의실 A, 현장"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">시간</label>
                <input
                  type="text"
                  value={modal.time_text}
                  maxLength={80}
                  onChange={(e) => setModal({ ...modal, time_text: e.target.value })}
                  placeholder="예: 14:00~16:00 / 오전 종일"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">참석자</label>
                <input
                  type="text"
                  value={modal.attendees}
                  maxLength={300}
                  onChange={(e) => setModal({ ...modal, attendees: e.target.value })}
                  placeholder="예: 홍길동, 김철수"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              <div className="pt-1 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-2 mt-3">
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
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-medium text-slate-500">
                        부서 공용
                      </label>
                      <button
                        type="button"
                        onClick={() => setManageOpen(true)}
                        className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        관리
                      </button>
                    </div>
                    {purposes.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        아직 공용 용도가 없습니다. 관리에서 추가해 주세요.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {purposes.map((p) => {
                          const selected = modal.color_purpose_id === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() =>
                                setModal({
                                  ...modal,
                                  color_purpose_id: p.id,
                                  color: p.color,
                                })
                              }
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                                selected
                                  ? 'border-slate-800 bg-slate-50 text-slate-900'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                              }`}
                            >
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: p.color }}
                              />
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 block mb-1.5">
                      개인 설정
                    </label>
                    <div className="flex gap-2">
                      {COLORS.map((c) => {
                        const selected =
                          modal.color_purpose_id === null && modal.color === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() =>
                              setModal({ ...modal, color_purpose_id: null, color: c })
                            }
                            className={`w-7 h-7 rounded-full border-2 ${
                              selected ? 'border-slate-800 scale-110' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: c }}
                            aria-label={`개인 색상 ${c}`}
                          />
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      개인 색상은 이 일정에만 적용됩니다.
                    </p>
                  </div>
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

      {manageOpen && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            if (!busy) {
              setManageOpen(false);
              setPurposeEdit(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
                  Department Colors
                </p>
                <h3 className="text-base font-semibold text-slate-900">부서 공용 용도·색상</h3>
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  소속 누구나 추가·변경할 수 있습니다. 색상을 바꾸면 그 용도로 등록된 일정이
                  일괄 반영됩니다.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setManageOpen(false);
                  setPurposeEdit(null);
                }}
                className="text-[12px] text-slate-500 hover:text-slate-800"
              >
                닫기
              </button>
            </div>

            <ul className="space-y-2 max-h-[40vh] overflow-y-auto mb-3">
              {purposes.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-800 truncate">{p.label}</p>
                    {p.updated_by_name ? (
                      <p className="text-[10px] text-slate-400 truncate">
                        최근 변경 · {p.updated_by_name}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setPurposeEdit({
                        mode: 'edit',
                        id: p.id,
                        label: p.label,
                        color: p.color,
                      })
                    }
                    className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deletePurpose(p)}
                    className="text-[11px] font-medium text-rose-600 hover:text-rose-700"
                  >
                    삭제
                  </button>
                </li>
              ))}
              {purposes.length === 0 ? (
                <li className="py-6 text-center text-[12px] text-slate-400">등록된 용도 없음</li>
              ) : null}
            </ul>

            {!purposeEdit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setPurposeEdit({
                    mode: 'create',
                    label: '',
                    color: COLORS[0],
                  })
                }
                className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                + 용도 추가
              </button>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                <p className="text-[11px] font-medium text-slate-700">
                  {purposeEdit.mode === 'create' ? '용도 추가' : '용도 수정'}
                </p>
                <input
                  value={purposeEdit.label}
                  onChange={(e) =>
                    setPurposeEdit({ ...purposeEdit, label: e.target.value })
                  }
                  placeholder="예: 출장, 내부회의"
                  maxLength={40}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPurposeEdit({ ...purposeEdit, color: c })}
                      className={`w-7 h-7 rounded-full border-2 ${
                        purposeEdit.color === c
                          ? 'border-slate-800 scale-110'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPurposeEdit(null)}
                    className="px-3 py-1.5 rounded-lg text-[11px] text-slate-600 hover:bg-white"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={busy || !purposeEdit.label.trim()}
                    onClick={() => void savePurposeEdit()}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
