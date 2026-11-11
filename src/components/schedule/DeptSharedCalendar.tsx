'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
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

/** 30분 간격 시간 선택 · 타임라인 (07:00 ~ 23:00) */
const TIME_RANGE_START_MIN = 7 * 60;
const TIME_RANGE_END_MIN = 23 * 60;
const TIME_OPTIONS: string[] = Array.from(
  { length: (TIME_RANGE_END_MIN - TIME_RANGE_START_MIN) / 30 + 1 },
  (_, i) => {
    const total = TIME_RANGE_START_MIN + i * 30;
    return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
  }
);

function parseTimeText(raw: string): { start_time: string; end_time: string } {
  const s = String(raw || '').trim();
  if (!s) return { start_time: '', end_time: '' };
  const m = s.match(/^(\d{1,2}):(\d{2})\s*[~\-–—]\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    return {
      start_time: `${pad2(Number(m[1]))}:${m[2]}`,
      end_time: `${pad2(Number(m[3]))}:${m[4]}`,
    };
  }
  const single = s.match(/^(\d{1,2}):(\d{2})$/);
  if (single) {
    return { start_time: `${pad2(Number(single[1]))}:${single[2]}`, end_time: '' };
  }
  return { start_time: '', end_time: '' };
}

function composeTimeText(start_time: string, end_time: string) {
  const a = String(start_time || '').trim();
  const b = String(end_time || '').trim();
  if (a && b) return `${a}~${b}`;
  if (a) return a;
  if (b) return b;
  return '';
}

/** 내용/프로젝트 복수 항목 — title 필드에 줄바꿈으로 저장 */
function splitTitles(raw: string): string[] {
  const parts = String(raw || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

function joinTitles(titles: string[]): string {
  return titles.map((t) => String(t || '').trim()).filter(Boolean).join('\n');
}

function formatTitlesInline(raw: string): string {
  return splitTitles(raw).filter(Boolean).join(' · ');
}

/** 인쇄 HTML용 — 복수 내용/프로젝트는 줄바꿈 */
function formatTitlesHtml(raw: string): string {
  const parts = splitTitles(raw).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((t) => escapeHtml(t)).join('<br/>');
}

/** 참석자: 4명까지 한 줄 고정, 5명부터 줄바꿈(칸 너비로 중간 끊김 방지) */
function formatAttendeesHtml(raw: string): string {
  const names = String(raw || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return '';
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += 4) {
    const chunk = names
      .slice(i, i + 4)
      .map((n) => escapeHtml(n))
      .join(', ');
    // nowrap으로 4명이 CSS에 의해 3명에서 끊기지 않게 함
    lines.push(`<span class="att-line">${chunk}</span>`);
  }
  return lines.join('<br/>');
}

function snapToTimeSlot(hhmm: string): string {
  const [h, m] = String(hhmm || '')
    .split(':')
    .map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const total = h * 60 + m;
  const snapped = Math.round(total / 30) * 30;
  const clamped = Math.min(
    TIME_RANGE_END_MIN,
    Math.max(TIME_RANGE_START_MIN, snapped)
  );
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** 타임라인 30분 칸 높이(px) — 범위 블록 absolute 배치용 */
const TIMELINE_SLOT_H = 28;

function resolveSlotIndex(hhmm: string): number {
  const snapped = TIME_OPTIONS.includes(hhmm) ? hhmm : snapToTimeSlot(hhmm);
  return TIME_OPTIONS.indexOf(snapped);
}

type TimelineSpan = {
  ev: CalEvent;
  startIdx: number;
  /** exclusive — 종료 시각 줄에서 블록이 끝남 */
  endIdx: number;
  lane: number;
  lanes: number;
  rangeLabel: string;
};

function buildTimelineSpans(dayEvents: CalEvent[]): {
  untimedEvents: CalEvent[];
  timedSpans: TimelineSpan[];
} {
  const untimed: CalEvent[] = [];
  const raw: Array<Omit<TimelineSpan, 'lane' | 'lanes'>> = [];

  for (const ev of dayEvents) {
    const times = parseTimeText(String(ev.time_text || ''));
    if (!times.start_time && !times.end_time) {
      untimed.push(ev);
      continue;
    }
    let startIdx = times.start_time ? resolveSlotIndex(times.start_time) : -1;
    let endIdx = times.end_time ? resolveSlotIndex(times.end_time) : -1;
    if (startIdx < 0 && endIdx < 0) {
      untimed.push(ev);
      continue;
    }
    if (startIdx < 0) startIdx = endIdx;
    // 종료 시각까지 보이게: 블록 하단이 종료 슬롯 줄에 오도록 exclusive end
    if (endIdx < 0) endIdx = startIdx + 1;
    else if (endIdx <= startIdx) endIdx = startIdx + 1;

    endIdx = Math.min(TIME_OPTIONS.length, endIdx);
    startIdx = Math.max(0, Math.min(startIdx, TIME_OPTIONS.length - 1));
    if (endIdx <= startIdx) endIdx = startIdx + 1;

    raw.push({
      ev,
      startIdx,
      endIdx,
      rangeLabel: composeTimeText(
        times.start_time || TIME_OPTIONS[startIdx],
        times.end_time || ''
      ),
    });
  }

  raw.sort(
    (a, b) =>
      a.startIdx - b.startIdx || b.endIdx - b.startIdx - (a.endIdx - a.startIdx)
  );

  const active: Array<{ endIdx: number; lane: number }> = [];
  const placed: TimelineSpan[] = [];
  for (const item of raw) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endIdx <= item.startIdx) active.splice(i, 1);
    }
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    active.push({ endIdx: item.endIdx, lane });
    placed.push({ ...item, lane, lanes: 1 });
  }

  for (const r of placed) {
    const overlapping = placed.filter(
      (o) => o.startIdx < r.endIdx && o.endIdx > r.startIdx
    );
    r.lanes = Math.max(1, ...overlapping.map((o) => o.lane + 1));
  }

  return { untimedEvents: untimed, timedSpans: placed };
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
          <td>종일</td>
          <td>${escapeHtml(holiday)}</td>
          <td>—</td>
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
            <td>${escapeHtml(String(ev.time_text || '').trim() || '—')}</td>
            <td>${formatTitlesHtml(ev.title || '')}</td>
            <td>${escapeHtml(String(ev.location || '').trim() || '—')}</td>
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
                <th>시간</th>
                <th>내용/프로젝트</th>
                <th>위치</th>
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
    table.detail-table th:nth-child(1) { width: 14%; }
    table.detail-table th:nth-child(2) { width: 38%; }
    table.detail-table th:nth-child(3) { width: 22%; }
    table.detail-table th:nth-child(4) { width: 26%; }
    table.detail-table td {
      padding: 4px 6px;
      border-bottom: 1px solid #f1f5f9;
      border-right: 1px solid #f1f5f9;
      word-break: break-word;
      min-height: 18px;
      vertical-align: top;
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

function resolvePurposeForPrint(
  ev: CalEvent,
  purposes: ColorPurpose[]
): { label: string; color: string | null; isShared: boolean } {
  const id = String(ev.color_purpose_id || '').trim();
  if (!id) {
    return { label: '개인', color: ev.color || null, isShared: false };
  }
  const found = purposes.find((p) => p.id === id);
  if (!found) {
    return { label: '부서공용', color: ev.color || null, isShared: true };
  }
  return { label: found.label, color: found.color || ev.color || null, isShared: true };
}

/** 선택일 일정 엑셀 다운로드 */
async function downloadDayScheduleExcel(opts: {
  dateStr: string;
  unitName: string;
  events: CalEvent[];
  purposes: ColorPurpose[];
  holiday?: string | null;
}) {
  const { dateStr, unitName, events, purposes, holiday } = opts;
  const parsed = parseYmd(dateStr);
  const dow = parsed
    ? WEEKDAYS[new Date(parsed.y, parsed.m - 1, parsed.d).getDay()]
    : '';
  const title = parsed
    ? `${parsed.y}.${pad2(parsed.m)}.${pad2(parsed.d)}(${dow})`
    : dateStr;
  const dayEvents = events.filter((ev) => eventCoversDate(ev, dateStr));

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('일일정');

  sheet.mergeCells(1, 1, 1, 5);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${title} 공유 일정${unitName ? ` / ${unitName}` : ''} · ${dayEvents.length}건`;
  titleCell.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 24;

  const headers = ['시간', '용도', '내용/프로젝트', '위치', '참석자'];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(2);
  headerRow.height = 20;
  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  headerRow.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border;
  });

  const pushDataRow = (vals: string[]) => {
    const row = sheet.addRow(vals);
    row.eachCell((cell, col) => {
      cell.font = { name: '맑은 고딕', size: 9, color: { argb: 'FF222222' } };
      cell.border = border;
      cell.alignment = {
        vertical: 'middle',
        horizontal: col === 1 || col === 2 ? 'center' : 'left',
        wrapText: true,
      };
    });
    const lines = Math.max(
      1,
      ...vals.map((v) => String(v || '').split(/\n/).length)
    );
    row.height = Math.max(18, lines * 14);
  };

  if (holiday) {
    pushDataRow(['종일', '공휴일', holiday, '', '']);
  }
  if (dayEvents.length === 0 && !holiday) {
    pushDataRow(['', '', '등록된 일정이 없습니다', '', '']);
  } else {
    for (const ev of dayEvents) {
      const purpose = resolvePurposeForPrint(ev, purposes);
      const titles = splitTitles(String(ev.title || ''))
        .filter(Boolean)
        .join('\n');
      pushDataRow([
        String(ev.time_text || '').trim(),
        purpose.label,
        titles,
        String(ev.location || '').trim(),
        String(ev.attendees || '').trim(),
      ]);
    }
  }

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 32;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 28;

  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `공유일정_${safeName}.xlsx`
  );
}

/** 월간 일정 엑셀 다운로드 */
async function downloadMonthScheduleExcel(opts: {
  year: number;
  month: number;
  unitName: string;
  events: CalEvent[];
  purposes: ColorPurpose[];
  holidays: Map<string, string>;
}) {
  const { year, month, unitName, events, purposes, holidays } = opts;
  const title = `${year}.${pad2(month)}`;
  const lastDay = new Date(year, month, 0).getDate();

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('월일정');

  let totalEvents = 0;
  for (let d = 1; d <= lastDay; d++) {
    totalEvents += events.filter((ev) =>
      eventCoversDate(ev, ymd(year, month, d))
    ).length;
  }

  sheet.mergeCells(1, 1, 1, 6);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${title} 공유 일정${unitName ? ` / ${unitName}` : ''} · ${totalEvents}건`;
  titleCell.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 24;

  const headers = ['일자', '시간', '용도', '내용/프로젝트', '위치', '참석자'];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(2);
  headerRow.height = 20;
  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  headerRow.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border;
  });

  const pushDataRow = (vals: string[]) => {
    const row = sheet.addRow(vals);
    row.eachCell((cell, col) => {
      cell.font = { name: '맑은 고딕', size: 9, color: { argb: 'FF222222' } };
      cell.border = border;
      cell.alignment = {
        vertical: 'middle',
        horizontal: col <= 3 ? 'center' : 'left',
        wrapText: true,
      };
    });
    const lines = Math.max(
      1,
      ...vals.map((v) => String(v || '').split(/\n/).length)
    );
    row.height = Math.max(18, lines * 14);
  };

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = ymd(year, month, d);
    const dow = WEEKDAYS[new Date(year, month - 1, d).getDay()];
    const dayLabel = `${d}(${dow})`;
    const holiday = holidays.get(dateStr);
    const dayEvents = events.filter((ev) => eventCoversDate(ev, dateStr));

    if (holiday) {
      pushDataRow([dayLabel, '종일', '공휴일', holiday, '', '']);
    }
    if (dayEvents.length === 0 && !holiday) {
      // 인쇄물과 동일하게 빈 날짜도 한 줄 유지
      pushDataRow([dayLabel, '', '', '', '', '']);
      continue;
    }

    for (const ev of dayEvents) {
      const purpose = resolvePurposeForPrint(ev, purposes);
      const titles = splitTitles(String(ev.title || ''))
        .filter(Boolean)
        .join('\n');
      pushDataRow([
        dayLabel,
        String(ev.time_text || '').trim(),
        purpose.label,
        titles,
        String(ev.location || '').trim(),
        String(ev.attendees || '').trim(),
      ]);
    }
  }

  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 32;
  sheet.getColumn(5).width = 18;
  sheet.getColumn(6).width = 28;

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `공유일정_${title}.xlsx`
  );
}

/** 선택일 일정 인쇄/다운로드용 HTML (엑셀 표 느낌) */
function buildDayPrintHtml(opts: {
  dateStr: string;
  unitName: string;
  events: CalEvent[];
  purposes: ColorPurpose[];
  holiday?: string | null;
}) {
  const { dateStr, unitName, events, purposes, holiday } = opts;
  const parsed = parseYmd(dateStr);
  const dow = parsed
    ? WEEKDAYS[new Date(parsed.y, parsed.m - 1, parsed.d).getDay()]
    : '';
  const title = parsed
    ? `${parsed.y}.${pad2(parsed.m)}.${pad2(parsed.d)}(${dow})`
    : dateStr;
  const unitLabel = unitName ? ` / ${escapeHtml(unitName)}` : '';
  const dayEvents = events.filter((ev) => eventCoversDate(ev, dateStr));

  const detailRows: string[] = [];
  if (holiday) {
    detailRows.push(`
      <tr>
        <td class="time">종일</td>
        <td class="purpose">공휴일</td>
        <td>${escapeHtml(holiday)}</td>
        <td></td>
        <td class="attendees"></td>
      </tr>`);
  }
  if (dayEvents.length === 0 && !holiday) {
    detailRows.push(`
      <tr>
        <td colspan="5" class="empty">등록된 일정이 없습니다</td>
      </tr>`);
  } else {
    for (const ev of dayEvents) {
      const purpose = resolvePurposeForPrint(ev, purposes);
      detailRows.push(`
        <tr>
          <td class="time">${escapeHtml(String(ev.time_text || '').trim() || '')}</td>
          <td class="purpose">${escapeHtml(purpose.label)}</td>
          <td>${formatTitlesHtml(ev.title || '')}</td>
          <td>${escapeHtml(String(ev.location || '').trim() || '')}</td>
          <td class="attendees">${formatAttendeesHtml(String(ev.attendees || ''))}</td>
        </tr>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>공유 일정 ${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      font-size: 8pt;
      color: #222;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }
    .header {
      margin: 0 0 8px;
      padding: 0 0 6px;
      border-bottom: 1px solid #B4B4B4;
    }
    .header h1 {
      margin: 0;
      font-size: 10pt;
      font-weight: 700;
      font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    }
    .header p {
      margin: 2px 0 0;
      font-size: 8pt;
      color: #444;
      font-weight: 400;
    }
    table.detail-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      font-size: 8pt;
    }
    table.detail-table th,
    table.detail-table td {
      border: 1px solid #BFBFBF;
      padding: 3px 4px;
      vertical-align: middle;
      text-align: left;
      font-size: 8pt;
      font-weight: 400;
      color: #222;
    }
    table.detail-table th {
      background: #DDEBF7;
      font-weight: 700;
      text-align: center;
      color: #222;
    }
    table.detail-table col.c-time { width: 12%; }
    table.detail-table col.c-purpose { width: 14%; }
    table.detail-table col.c-title { width: 34%; }
    table.detail-table col.c-loc { width: 14%; }
    table.detail-table col.c-att { width: 26%; }
    table.detail-table td.time {
      white-space: nowrap;
      word-break: keep-all;
      text-align: center;
    }
    table.detail-table td.purpose {
      word-break: keep-all;
      overflow-wrap: break-word;
      text-align: center;
      line-height: 1.3;
    }
    table.detail-table td.attendees {
      line-height: 1.35;
    }
    table.detail-table .att-line {
      white-space: nowrap;
      display: inline-block;
    }
    table.detail-table td.empty {
      text-align: center;
      color: #888;
      padding: 12px 5px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)} 공유 일정</h1>
    <p>일별${unitLabel} · ${dayEvents.length}건</p>
  </div>
  <table class="detail-table">
    <colgroup>
      <col class="c-time" />
      <col class="c-purpose" />
      <col class="c-title" />
      <col class="c-loc" />
      <col class="c-att" />
    </colgroup>
    <thead>
      <tr>
        <th>시간</th>
        <th>용도</th>
        <th>내용/프로젝트</th>
        <th>위치</th>
        <th>참석자</th>
      </tr>
    </thead>
    <tbody>${detailRows.join('')}</tbody>
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

  const runWhenReady = () => {
    const fonts = doc.fonts;
    if (fonts?.ready) {
      // 웹폰트(Noto Sans KR) 로드 후 인쇄 — 실패해도 시스템 폰트로 진행
      Promise.race([
        fonts.ready,
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]).then(() => setTimeout(triggerPrint, 50));
      return;
    }
    setTimeout(triggerPrint, 200);
  };

  if (doc.readyState === 'complete') {
    runWhenReady();
  } else {
    iframe.onload = () => runWhenReady();
    setTimeout(runWhenReady, 500);
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
      title: formatTitlesInline(ev.title) || ev.title || '—',
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
      titles: string[];
      location: string;
      start_time: string;
      end_time: string;
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

  const { untimedEvents, timedSpans } = useMemo(
    () => buildTimelineSpans(selectedDayEvents),
    [selectedDayEvents]
  );

  const coveredSlotIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const span of timedSpans) {
      for (let i = span.startIdx; i < span.endIdx; i++) set.add(i);
    }
    return set;
  }, [timedSpans]);

  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const firstTimedSlot = useMemo(() => {
    if (timedSpans.length === 0) return '09:00';
    let bestIdx = timedSpans[0].startIdx;
    for (const s of timedSpans) {
      if (s.startIdx < bestIdx) bestIdx = s.startIdx;
    }
    return TIME_OPTIONS[bestIdx] || '09:00';
  }, [timedSpans]);

  useEffect(() => {
    const root = timelineScrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-time-slot="${firstTimedSlot}"]`);
    if (!target) return;
    root.scrollTop = Math.max(0, target.offsetTop - 8);
  }, [selectedDate, firstTimedSlot]);

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

  const openCreate = (dateStr: string, startTime = '') => {
    setSelectedDate(dateStr);
    const firstPurpose = purposes[0];
    const start_time = startTime && TIME_OPTIONS.includes(startTime) ? startTime : '';
    let end_time = '';
    if (start_time) {
      const idx = TIME_OPTIONS.indexOf(start_time);
      end_time = idx >= 0 && idx + 1 < TIME_OPTIONS.length ? TIME_OPTIONS[idx + 1] : '';
    }
    setModal({
      mode: 'create',
      titles: [''],
      location: '',
      start_time,
      end_time,
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
    const times = parseTimeText(String(ev.time_text || ''));
    setModal({
      mode: 'edit',
      id: ev.id,
      titles: splitTitles(ev.title || ''),
      location: String(ev.location || ''),
      start_time: times.start_time,
      end_time: times.end_time,
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
    const title = joinTitles(modal.titles);
    if (!title) return alert('내용/프로젝트를 입력해 주세요.');
    if (!parseYmd(modal.start_date)) return alert('시작일을 확인해 주세요.');
    setBusy(true);
    try {
      const payload = {
        id: modal.id,
        title,
        location: modal.location.trim(),
        time_text: composeTimeText(modal.start_time, modal.end_time),
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
          <div className="inline-flex items-stretch rounded-lg border border-slate-200 overflow-hidden shadow-sm">
            <button
              type="button"
              title={`${viewYear}.${pad2(viewMonth)} 인쇄·PDF 다운`}
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
              className="h-7 px-2.5 bg-sky-50 text-sky-700 text-[10px] font-medium hover:bg-sky-100 border-r border-slate-200"
            >
              ⬇ 월·일정
            </button>
            <button
              type="button"
              title={`${viewYear}.${pad2(viewMonth)} 엑셀 다운`}
              onClick={() => {
                void downloadMonthScheduleExcel({
                  year: viewYear,
                  month: viewMonth,
                  unitName,
                  events,
                  purposes,
                  holidays,
                }).catch((err) => {
                  console.error('[schedule month excel]', err);
                  alert('엑셀 다운로드에 실패했습니다.');
                });
              }}
              className="h-7 px-2.5 bg-emerald-50 text-emerald-700 text-[10px] font-medium hover:bg-emerald-100"
            >
              엑셀
            </button>
          </div>
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
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="ml-auto h-7 px-2.5 rounded-md border border-slate-200 bg-white text-slate-700 text-[10px] font-medium hover:bg-slate-50 shrink-0"
        >
          색상 관리
        </button>
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

      {/* Detail — 시간 타임라인 */}
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
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-stretch rounded-lg border border-slate-200 overflow-hidden shadow-sm">
              <button
                type="button"
                title={`${formatDotDate(selectedDate)} 인쇄·PDF 다운`}
                onClick={() => {
                  const html = buildDayPrintHtml({
                    dateStr: selectedDate,
                    unitName,
                    events,
                    purposes,
                    holiday: selectedHoliday,
                  });
                  openMonthPrint(html);
                }}
                className="h-7 px-2.5 bg-sky-50 text-sky-700 text-[10px] font-medium hover:bg-sky-100 border-r border-slate-200"
              >
                ⬇ 일·일정
              </button>
              <button
                type="button"
                title={`${formatDotDate(selectedDate)} 엑셀 다운`}
                onClick={() => {
                  void downloadDayScheduleExcel({
                    dateStr: selectedDate,
                    unitName,
                    events,
                    purposes,
                    holiday: selectedHoliday,
                  }).catch((err) => {
                    console.error('[schedule day excel]', err);
                    alert('엑셀 다운로드에 실패했습니다.');
                  });
                }}
                className="h-7 px-2.5 bg-emerald-50 text-emerald-700 text-[10px] font-medium hover:bg-emerald-100"
              >
                엑셀
              </button>
            </div>
            <button
              type="button"
              onClick={() => openCreate(selectedDate)}
              className="h-7 px-2.5 rounded-md bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700"
            >
              + 일정
            </button>
          </div>
        </div>

        <div ref={timelineScrollRef} className="flex-1 overflow-auto">
          {(selectedHoliday || untimedEvents.length > 0) && (
            <div className="border-b border-slate-100 bg-slate-50/80 px-3 py-2 space-y-1.5">
              <p className="text-[10px] font-medium text-slate-500">종일 · 시간 미정</p>
              {selectedHoliday && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-2 text-[11px]">
                  <span
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: KR_HOLIDAY_COLOR }}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-rose-700 truncate">{selectedHoliday}</p>
                    <p className="text-[10px] text-rose-400 mt-0.5">공휴일 · 종일</p>
                  </div>
                </div>
              )}
              {untimedEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openEdit(ev)}
                  className="w-full text-left flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors"
                >
                  <span
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ev.color || COLORS[0] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[11px] font-medium text-slate-800 truncate"
                      title={formatTitlesInline(ev.title) || ev.title}
                    >
                      {formatTitlesInline(ev.title) || '—'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      {[ev.location?.trim(), ev.attendees?.trim()].filter(Boolean).join(' · ') ||
                        '시간 미정'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedDayEvents.length === 0 && !selectedHoliday && untimedEvents.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-slate-400 border-b border-slate-100">
              시간을 클릭하면 새 일정을 등록할 수 있습니다
            </p>
          ) : null}

          <div
            className="relative pl-0 pr-2 py-1"
            style={{ height: TIME_OPTIONS.length * TIMELINE_SLOT_H + 8 }}
          >
            {TIME_OPTIONS.map((slot, idx) => {
              const isHour = slot.endsWith(':00');
              const covered = coveredSlotIndexes.has(idx);
              return (
                <button
                  key={slot}
                  type="button"
                  data-time-slot={slot}
                  onClick={() => openCreate(selectedDate, slot)}
                  title={`${slot} 일정 등록`}
                  className={`absolute left-0 right-0 grid grid-cols-[52px_minmax(0,1fr)] gap-0 border-t text-left hover:bg-indigo-50/50 transition-colors ${
                    isHour ? 'border-slate-200' : 'border-slate-100'
                  }`}
                  style={{ top: idx * TIMELINE_SLOT_H, height: TIMELINE_SLOT_H }}
                >
                  <div
                    className={`pt-1 pr-2 text-right tabular-nums leading-none ${
                      isHour
                        ? 'text-[11px] font-medium text-slate-600'
                        : 'text-[9px] font-normal text-slate-300'
                    }`}
                  >
                    {slot}
                  </div>
                  <div className="relative border-l border-slate-200">
                    <span
                      className={`absolute -left-[3.5px] top-1.5 w-1.5 h-1.5 rounded-full ${
                        covered
                          ? 'bg-indigo-500'
                          : isHour
                            ? 'bg-slate-300'
                            : 'bg-slate-200'
                      }`}
                    />
                  </div>
                </button>
              );
            })}

            <div className="absolute top-0 bottom-0 left-[52px] right-2 pointer-events-none">
              {timedSpans.map((span) => {
                const top = span.startIdx * TIMELINE_SLOT_H + 2;
                const height = Math.max(
                  TIMELINE_SLOT_H - 4,
                  (span.endIdx - span.startIdx) * TIMELINE_SLOT_H - 4
                );
                const widthPct = 100 / span.lanes;
                const leftPct = span.lane * widthPct;
                const color = span.ev.color || COLORS[0];
                return (
                  <button
                    key={span.ev.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(span.ev);
                    }}
                    className="absolute pointer-events-auto text-left rounded-md border border-slate-200 bg-white/95 px-2 py-1 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors shadow-sm overflow-hidden z-[1]"
                    style={{
                      top,
                      height,
                      left: `calc(${leftPct}% + 6px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      borderLeftWidth: 3,
                      borderLeftColor: color,
                      backgroundColor: `${color}18`,
                    }}
                    title={[
                      formatTitlesInline(span.ev.title),
                      span.rangeLabel,
                      span.ev.location,
                      span.ev.attendees,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    <div className="flex items-baseline justify-between gap-1 min-w-0">
                      <div className="min-w-0 flex-1">
                        {height >= TIMELINE_SLOT_H * 1.6 &&
                        splitTitles(span.ev.title).filter(Boolean).length > 1 ? (
                          splitTitles(span.ev.title)
                            .filter(Boolean)
                            .map((name, i) => (
                              <p
                                key={`${span.ev.id}-t-${i}`}
                                className="text-[11px] font-medium text-slate-800 truncate leading-tight"
                              >
                                {name}
                              </p>
                            ))
                        ) : (
                          <p className="text-[11px] font-medium text-slate-800 truncate">
                            {formatTitlesInline(span.ev.title) || '—'}
                          </p>
                        )}
                      </div>
                      {span.rangeLabel ? (
                        <span className="text-[9px] tabular-nums text-slate-500 shrink-0">
                          {span.rangeLabel}
                        </span>
                      ) : null}
                    </div>
                    {height >= TIMELINE_SLOT_H * 1.2 &&
                      (span.ev.location?.trim() || span.ev.attendees?.trim()) && (
                        <p className="text-[10px] text-slate-600 mt-0.5 truncate">
                          {[span.ev.location?.trim(), span.ev.attendees?.trim()]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                  </button>
                );
              })}
            </div>
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
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[10px] font-medium text-slate-500">
                    내용/프로젝트
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setModal({ ...modal, titles: [...modal.titles, ''] })
                    }
                    className="h-6 px-2 rounded-md text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100"
                  >
                    + 추가
                  </button>
                </div>
                <div className="space-y-1.5">
                  {modal.titles.map((t, idx) => (
                    <div key={`title-${idx}`} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={t}
                        maxLength={120}
                        onChange={(e) => {
                          const next = [...modal.titles];
                          next[idx] = e.target.value;
                          setModal({ ...modal, titles: next });
                        }}
                        placeholder={
                          idx === 0 ? '예: 프로젝트명 등' : `프로젝트명 ${idx + 1}`
                        }
                        className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200"
                        autoFocus={idx === 0}
                      />
                      {modal.titles.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setModal({
                              ...modal,
                              titles: modal.titles.filter((_, i) => i !== idx),
                            })
                          }
                          className="h-10 w-9 shrink-0 rounded-xl border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 text-sm"
                          aria-label="항목 삭제"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-1">위치</label>
                <input
                  type="text"
                  value={modal.location}
                  maxLength={200}
                  onChange={(e) => setModal({ ...modal, location: e.target.value })}
                  placeholder="예: 1회의실, 서울시 00구, 경기도 00시 등"
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
                    <label className="text-[10px] font-medium text-slate-500 block mb-1 mt-2">
                      시작 시간
                    </label>
                    <select
                      value={modal.start_time}
                      onChange={(e) => setModal({ ...modal, start_time: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                    >
                      <option value="">선택 안 함</option>
                      {modal.start_time &&
                        !TIME_OPTIONS.includes(modal.start_time) && (
                          <option value={modal.start_time}>{modal.start_time}</option>
                        )}
                      {TIME_OPTIONS.map((t) => (
                        <option key={`start-${t}`} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
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
                    <label className="text-[10px] font-medium text-slate-500 block mb-1 mt-2">
                      종료 시간
                    </label>
                    <select
                      value={modal.end_time}
                      onChange={(e) => setModal({ ...modal, end_time: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm font-normal outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                    >
                      <option value="">선택 안 함</option>
                      {modal.end_time && !TIME_OPTIONS.includes(modal.end_time) && (
                        <option value={modal.end_time}>{modal.end_time}</option>
                      )}
                      {TIME_OPTIONS.map((t) => (
                        <option key={`end-${t}`} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
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
                    disabled={busy || !modal.titles.some((t) => t.trim())}
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
                  placeholder="예: 현장실사/외부심사, 심의"
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
