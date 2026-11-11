'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { getKSTDateString, getKSTNowYearMonth } from '@/utils/dateUtils';
import { getKrHolidaysForYear, KR_HOLIDAY_COLOR } from '@/utils/krHolidays';
import {
  deriveProjectStatus,
  type WorkBoardLine,
  type WorkStatus,
} from '@/lib/work-board-lines';

type WorkItem = {
  id: string;
  title: string;
  note?: string | null;
  status: string;
  sort_order?: number;
  board_date?: string | null;
  due_date?: string | null;
  urgent?: boolean;
  lines?: WorkBoardLine[];
  assignee_name?: string | null;
  creator_name?: string | null;
};

function isUrgent(item: { urgent?: boolean | null }) {
  return Boolean(item.urgent);
}

/** 보드일 ~ 마감일 (마감 없으면 보드일 하루) */
function itemDateSpan(item: WorkItem): { start: string; end: string } | null {
  const start = asYmd(item.board_date);
  if (!start) return null;
  let end = asYmd(item.due_date, start);
  if (end < start) end = start;
  return { start, end };
}

function itemCoversDate(item: WorkItem, dateStr: string) {
  const span = itemDateSpan(item);
  if (!span) return false;
  return dateStr >= span.start && dateStr <= span.end;
}

/** 연한 하늘색 등록 / 연한 로즈 긴급 (텍스트는 진하게) */
function itemBarStyle(item: WorkItem): { backgroundColor: string; color: string } {
  if (isUrgent(item)) {
    return { backgroundColor: '#fecdd3', color: '#9f1239' }; // rose-200 / rose-800
  }
  const lines = Array.isArray(item.lines) ? item.lines : [];
  const st = lines.length
    ? deriveProjectStatus(lines)
    : normalizeStatus(item.status) || 'TODO';
  if (st === 'DONE') {
    return { backgroundColor: '#bbf7d0', color: '#166534' }; // emerald-200
  }
  // 할 일·진행 중 — 연한 하늘색
  return { backgroundColor: '#bae6fd', color: '#0c4a6e' }; // sky-200 / sky-900
}

type DayCell = { dateStr: string; day: number };

type WbSeg = {
  key: string;
  title: string;
  backgroundColor: string;
  color: string;
  startCol: number;
  endCol: number;
  item: WorkItem;
};

const MAX_WB_LANES = 3;
const WB_LANE_H = 14;

function segmentsOverlap(a: { startCol: number; endCol: number }, b: { startCol: number; endCol: number }) {
  return !(a.endCol < b.startCol || a.startCol > b.endCol);
}

function layoutWorkWeekLanes(week: Array<DayCell | null>, items: WorkItem[]): WbSeg[][] {
  const segs: WbSeg[] = [];
  for (const item of items) {
    const span = itemDateSpan(item);
    if (!span) continue;
    let startCol = -1;
    let endCol = -1;
    for (let c = 0; c < 7; c++) {
      const cell = week[c];
      if (!cell) continue;
      if (cell.dateStr >= span.start && cell.dateStr <= span.end) {
        if (startCol < 0) startCol = c;
        endCol = c;
      }
    }
    if (startCol < 0) continue;
    const style = itemBarStyle(item);
    segs.push({
      key: `p-${item.id}-${week[startCol]?.dateStr || startCol}`,
      title: item.title,
      backgroundColor: style.backgroundColor,
      color: style.color,
      startCol,
      endCol,
      item,
    });
  }
  segs.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const da = a.endCol - a.startCol;
    const db = b.endCol - b.startCol;
    if (da !== db) return db - da;
    return a.title.localeCompare(b.title, 'ko');
  });
  const lanes: WbSeg[][] = [];
  for (const seg of segs) {
    let placed = false;
    for (const lane of lanes) {
      if (!lane.some((x) => segmentsOverlap(x, seg))) {
        lane.push(seg);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([seg]);
  }
  return lanes;
}

function renderWbLaneRow(lane: WbSeg[], onSegClick: (seg: WbSeg) => void) {
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
        title={
          isUrgent(seg.item)
            ? `긴급 · ${seg.title}`
            : seg.title
        }
        className="min-w-0 truncate rounded-sm px-1 text-[10px] font-medium text-left hover:opacity-90"
        style={{
          gridColumn: `span ${span}`,
          height: WB_LANE_H,
          lineHeight: `${WB_LANE_H}px`,
          backgroundColor: seg.backgroundColor,
          color: seg.color,
        }}
      >
        {isUrgent(seg.item) ? '! ' : ''}
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

type FormLine = {
  key: string;
  area: string;
  assignee_name: string;
  status: WorkStatus;
};

const COLUMNS: { key: WorkStatus; label: string; hint: string; accent: string }[] = [
  { key: 'TODO', label: '할 일', hint: 'To Do', accent: 'border-t-slate-400' },
  { key: 'DOING', label: '진행 중', hint: 'Doing', accent: 'border-t-sky-500' },
  { key: 'DONE', label: '완료', hint: 'Done', accent: 'border-t-emerald-500' },
];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const STATUS_LABEL: Record<WorkStatus, string> = {
  TODO: '할 일',
  DOING: '진행 중',
  DONE: '완료',
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatDotDate(s: string) {
  return String(s || '').replace(/-/g, '.') || '-';
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function asYmd(raw: unknown, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim();
  return YMD_RE.test(s) ? s : fallback;
}

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** PDF 저장 파일명은 상위 탭 document.title을 쓰는 브라우저가 많음 → 인쇄 직전에 교체 */
function openWorkBoardPrint(html: string, fileTitle: string) {
  const prevTitle = document.title;
  const safeTitle = String(fileTitle || '공유프로젝트').trim() || '공유프로젝트';
  document.title = safeTitle;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', safeTitle);
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    document.title = prevTitle;
    document.body.removeChild(iframe);
    alert('인쇄 창을 열 수 없습니다.');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = prevTitle;
    try {
      if (iframe.parentNode) document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } finally {
      // afterprint가 안 오는 환경 대비
      setTimeout(restore, 1500);
    }
  };

  try {
    win.addEventListener('afterprint', restore);
  } catch {
    /* ignore */
  }
  try {
    window.addEventListener('afterprint', restore, { once: true });
  } catch {
    /* ignore */
  }

  // iframe 로드 후 인쇄 (타이틀은 이미 상위 document에 반영됨)
  setTimeout(doPrint, 300);
}

/** 선택일 전체 프로젝트(할 일·진행·완료) 인쇄 HTML */
function buildDayPrintHtml(opts: {
  dateStr: string;
  unitName: string;
  items: WorkItem[];
}) {
  const { dateStr, unitName, items } = opts;
  const byCol: Record<WorkStatus, WorkItem[]> = { TODO: [], DOING: [], DONE: [] };
  for (const item of items) {
    const lines = Array.isArray(item.lines) ? item.lines : [];
    const key = lines.length
      ? deriveProjectStatus(lines)
      : ((normalizeStatus(item.status) || 'TODO') as WorkStatus);
    byCol[key].push(item);
  }

  const sections = COLUMNS.map((col) => {
    const list = byCol[col.key];
    const rows =
      list.length === 0
        ? `<tr><td colspan="4" class="empty">없음</td></tr>`
        : list
            .map((item) => {
              const lines = Array.isArray(item.lines) ? item.lines : [];
              const lineHtml = lines.length
                ? `<ul class="lines">${lines
                    .map(
                      (l) =>
                        `<li>${escapeHtml(l.area)}${
                          l.assignee_name
                            ? ` · ${escapeHtml(l.assignee_name)}`
                            : ''
                        } · <b>${escapeHtml(STATUS_LABEL[normalizeStatus(l.status) || 'TODO'])}</b></li>`
                    )
                    .join('')}</ul>`
                : '—';
              return `<tr class="${isUrgent(item) ? 'urgent' : ''}">
                <td class="c-proj">${isUrgent(item) ? '<b style="color:#e11d48">[긴급]</b> ' : ''}${escapeHtml(item.title)}</td>
                <td class="c-due">${escapeHtml(item.due_date || '—')}</td>
                <td class="c-note">${escapeHtml(String(item.note || '').trim() || '—')}</td>
                <td class="c-lines">${lineHtml}</td>
              </tr>`;
            })
            .join('');
    return `
      <h2>${escapeHtml(col.label)} <span>(${list.length})</span></h2>
      <table>
        <colgroup>
          <col class="c-proj" />
          <col class="c-due" />
          <col class="c-note" />
          <col class="c-lines" />
        </colgroup>
        <thead><tr>
          <th class="c-proj">프로젝트</th>
          <th class="c-due">마감</th>
          <th class="c-note">메모</th>
          <th class="c-lines">세부분야 · 담당 · 상태</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>공유프로젝트-${formatDotDate(dateStr)}</title>
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
  h2 {
    font-size: 9pt;
    font-weight: 700;
    margin: 12px 0 4px;
    color: #222;
  }
  h2 span { color: #888; font-weight: 400; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    table-layout: fixed;
    font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    font-size: 8pt;
  }
  col.c-proj { width: 34%; }
  col.c-due { width: 12%; }
  col.c-note { width: 16%; }
  col.c-lines { width: 38%; }
  th, td {
    border: 1px solid #BFBFBF;
    padding: 3px 4px;
    vertical-align: middle;
    text-align: left;
    word-break: break-word;
    font-size: 8pt;
    font-weight: 400;
    color: #222;
  }
  th {
    background: #DDEBF7;
    font-weight: 700;
    text-align: center;
  }
  th.c-due, td.c-due {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  td.empty { color: #888; text-align: center; padding: 10px 4px; }
  tr.urgent td { background: #FFF1F2; }
  ul.lines { margin: 0; padding-left: 14px; }
  ul.lines li { margin: 1px 0; }
  .total {
    margin-top: 10px;
    font-size: 8pt;
    color: #444;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
  <div class="header">
    <h1>${formatDotDate(dateStr)} 공유 프로젝트 업무 보드</h1>
    <p>일별${unitName ? ` / ${escapeHtml(unitName)}` : ''} · 전체 ${items.length}건</p>
  </div>
  ${sections}
  <p class="total">할 일 ${byCol.TODO.length} · 진행 중 ${byCol.DOING.length} · 완료 ${byCol.DONE.length}</p>
</body></html>`;
}

function formatWorkLinesPlain(item: WorkItem): string {
  const lines = Array.isArray(item.lines) ? item.lines : [];
  if (!lines.length) return '';
  return lines
    .map((l) => {
      const st = STATUS_LABEL[normalizeStatus(l.status) || 'TODO'];
      const who = String(l.assignee_name || '').trim();
      return `${String(l.area || '').trim()}${who ? ` · ${who}` : ''} · ${st}`;
    })
    .join('\n');
}

/** 선택일 워크보드 엑셀 */
async function downloadDayWorkBoardExcel(opts: {
  dateStr: string;
  unitName: string;
  items: WorkItem[];
}) {
  const { dateStr, unitName, items } = opts;
  const byCol: Record<WorkStatus, WorkItem[]> = { TODO: [], DOING: [], DONE: [] };
  for (const item of items) {
    const lines = Array.isArray(item.lines) ? item.lines : [];
    const key = lines.length
      ? deriveProjectStatus(lines)
      : ((normalizeStatus(item.status) || 'TODO') as WorkStatus);
    byCol[key].push(item);
  }

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('일보드');

  sheet.mergeCells(1, 1, 1, 5);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${formatDotDate(dateStr)} 공유 프로젝트 업무 보드${
    unitName ? ` / ${unitName}` : ''
  } · ${items.length}건`;
  titleCell.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 24;

  const headers = ['구분', '프로젝트', '마감', '메모', '세부분야 · 담당 · 상태'];
  sheet.addRow(headers);
  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const headerRow = sheet.getRow(2);
  headerRow.height = 20;
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
        horizontal: col === 1 || col === 3 ? 'center' : 'left',
        wrapText: true,
      };
    });
    const lines = Math.max(
      1,
      ...vals.map((v) => String(v || '').split(/\n/).length)
    );
    row.height = Math.max(18, lines * 14);
  };

  if (items.length === 0) {
    pushDataRow(['', '등록된 프로젝트가 없습니다', '', '', '']);
  } else {
    for (const col of COLUMNS) {
      for (const item of byCol[col.key]) {
        pushDataRow([
          col.label,
          `${isUrgent(item) ? '[긴급] ' : ''}${item.title || ''}`,
          String(item.due_date || '').trim(),
          String(item.note || '').trim(),
          formatWorkLinesPlain(item),
        ]);
      }
    }
  }

  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 36;

  const buffer = await workbook.xlsx.writeBuffer();
  const safe = formatDotDate(dateStr).replace(/[\\/:*?"<>|]/g, '-');
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `공유프로젝트-${safe}.xlsx`
  );
}

/** 월간 워크보드 엑셀 (일자별, 빈 날짜 포함) */
async function downloadMonthWorkBoardExcel(opts: {
  year: number;
  month: number;
  unitName: string;
  items: WorkItem[];
  holidays: Map<string, string>;
}) {
  const { year, month, unitName, items, holidays } = opts;
  const title = `${year}.${pad2(month)}`;
  const lastDay = new Date(year, month, 0).getDate();
  const byDate = new Map<string, WorkItem[]>();
  for (const item of items) {
    const span = itemDateSpan(item);
    if (!span) continue;
    let cur = span.start;
    while (cur <= span.end) {
      const [yy, mm, dd] = cur.split('-').map(Number);
      if (yy === year && mm === month) {
        const list = byDate.get(cur) || [];
        list.push(item);
        byDate.set(cur, list);
      }
      const next = new Date(yy, mm - 1, dd + 1);
      cur = ymd(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (cur <= span.start) break;
    }
  }

  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('월보드');

  let total = 0;
  for (let d = 1; d <= lastDay; d++) {
    total += (byDate.get(ymd(year, month, d)) || []).length;
  }

  sheet.mergeCells(1, 1, 1, 3);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${title} 공유 프로젝트${unitName ? ` / ${unitName}` : ''} · ${total}건`;
  titleCell.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 24;

  const headers = ['일자', '프로젝트', '비고'];
  sheet.addRow(headers);
  const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const headerRow = sheet.getRow(2);
  headerRow.height = 20;
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
        horizontal: col === 1 ? 'center' : 'left',
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
    const dayList = byDate.get(dateStr) || [];

    if (dayList.length === 0) {
      pushDataRow([dayLabel, '', holiday ? `공휴일 · ${holiday}` : '']);
      continue;
    }

    const titles = dayList
      .map((item) => `${isUrgent(item) ? '[긴급] ' : ''}${item.title || ''}`)
      .join('\n');
    pushDataRow([dayLabel, titles, holiday ? `공휴일 · ${holiday}` : '']);
  }

  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 42;
  sheet.getColumn(3).width = 22;

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `공유프로젝트-${title}.xlsx`
  );
}

/** 월간 일자별 등록 프로젝트 — 일자·제목만, A4 좌우 2단 */
function buildMonthPrintHtml(opts: {
  year: number;
  month: number;
  unitName: string;
  items: WorkItem[];
  holidays: Map<string, string>;
}) {
  const { year, month, unitName, items, holidays } = opts;
  const lastDay = new Date(year, month, 0).getDate();
  const title = `${year}.${pad2(month)}`;
  const byDate = new Map<string, WorkItem[]>();
  for (const item of items) {
    const span = itemDateSpan(item);
    if (!span) continue;
    // 보드일~마감일 구간의 모든 일자에 표기
    let cur = span.start;
    while (cur <= span.end) {
      const [yy, mm, dd] = cur.split('-').map(Number);
      if (yy === year && mm === month) {
        const list = byDate.get(cur) || [];
        list.push(item);
        byDate.set(cur, list);
      }
      const next = new Date(yy, mm - 1, dd + 1);
      cur = ymd(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (cur <= span.start) break; // safety
    }
  }

  const dayBlocks: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = ymd(year, month, d);
    const dayList = byDate.get(dateStr) || [];
    const dow = WEEKDAYS[new Date(year, month - 1, d).getDay()];
    const holiday = holidays.get(dateStr);
    const isWeekend = dow === '일' || dow === '토';
    const dayClass = [
      holiday ? 'holiday' : '',
      isWeekend ? 'weekend' : '',
      dayList.length === 0 ? 'empty' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const dateLabel = holiday
      ? `${d}(${dow}) <span class="hol">${escapeHtml(holiday)}</span>`
      : `${d}(${dow})`;

    const titles =
      dayList.length === 0
        ? ''
        : dayList
            .map((item) => {
              const mark = isUrgent(item) ? '<span class="u">!</span> ' : '';
              return `<div class="p">${mark}${escapeHtml(item.title)}</div>`;
            })
            .join('');

    dayBlocks.push(`
      <div class="day ${dayClass}">
        <div class="date">${dateLabel}${
          dayList.length > 0 ? ` <span class="n">${dayList.length}</span>` : ''
        }</div>
        <div class="body">${titles}</div>
      </div>`);
  }

  // 날짜를 반으로 나누지 않음 — CSS 2단 흐름(좌→우→다음 장 좌)
  // column-rule은 2장부터 잘 안 그려져서 fixed 세로선으로 매 장 표시
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>공유프로젝트-${title}</title>
  <style>
    @page { size: A4; margin: 10mm 8mm; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      color: #1e293b;
      font-size: 10px;
      margin: 0;
      padding: 0;
      position: relative;
    }
    /* 매 장 반복 외곽 */
    .page-chrome {
      position: fixed;
      inset: 0;
      border: 1px solid #94a3b8;
      pointer-events: none;
      z-index: 20;
    }
    /* 중간 세로선 — 배경색 대신 border로 (인쇄 누락 방지, 매 장 반복) */
    .mid-rule {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 0;
      margin: 0;
      padding: 0;
      border: none;
      border-left: 1.5px solid #475569;
      transform: translateX(-50%);
      pointer-events: none;
      z-index: 30;
    }
    .header {
      margin-bottom: 8px;
      border-bottom: 2px solid #334155;
      padding: 0 2px 6px;
      break-after: avoid;
      page-break-after: avoid;
    }
    .header h1 { margin: 0; font-size: 16px; font-weight: 700; }
    .header p { margin: 3px 0 0; font-size: 10px; color: #64748b; }
    /* 신문식 2단: 왼쪽을 채운 뒤 우측으로, 우측이 가득하면 다음 장 */
    .sheet {
      column-count: 2;
      column-gap: 16px;
      column-rule: 1.5px solid #475569;
      column-fill: auto;
      padding: 0 1px;
      border: none;
    }
    .day {
      display: grid;
      grid-template-columns: 58px 1fr;
      border-bottom: 2px solid #64748b;
      min-height: 48px;
      background: #fff;
      width: 100%;
      /* 일자 블록이 경계에 걸치면 쪼개지 말고 다음 단(우측)으로 */
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-column-break-inside: avoid;
      column-break-inside: avoid;
    }
    .day .date {
      padding: 4px 5px 2px;
      font-weight: 700;
      font-size: 11px;
      line-height: 1.25;
      text-align: left;
      vertical-align: top;
      color: #334155;
      background: #f1f5f9;
      border-right: 1px solid #cbd5e1;
    }
    .day .date .hol {
      display: block;
      font-size: 8px;
      font-weight: 600;
      margin-top: 1px;
    }
    .day .date .n {
      color: #64748b;
      font-weight: 600;
      font-size: 9px;
    }
    .day.weekend .date { color: #4f46e5; }
    .day.holiday .date {
      color: #e11d48;
      background: #fff1f2;
    }
    .day .body {
      padding: 4px 8px 4px 10px;
      min-height: 48px;
    }
    .day.empty .body {
      min-height: 54px;
      background-image: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 17px,
        #e2e8f0 17px,
        #e2e8f0 18px
      );
      background-size: 100% 18px;
    }
    .day .p {
      line-height: 1.4;
      margin: 0;
      padding: 2px 0;
      word-break: break-word;
    }
    .day .p + .p {
      border-top: 1px solid #e2e8f0;
      margin-top: 1px;
      padding-top: 3px;
    }
    .day .p .u { color: #e11d48; font-weight: 700; }
    @media print {
      body, .mid-rule, .page-chrome, .sheet {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .sheet { column-fill: auto; }
      .mid-rule {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 50%;
        border-left: 1.5px solid #475569;
      }
    }
  </style>
</head>
<body>
  <div class="page-chrome" aria-hidden="true"></div>
  <div class="mid-rule" aria-hidden="true"></div>
  <div class="header">
    <h1>공유 프로젝트 ${escapeHtml(title)}</h1>
    <p>공유 프로젝트 업무 보드${unitName ? ` · ${escapeHtml(unitName)}` : ''} · 일자 · 프로젝트명</p>
  </div>
  <div class="sheet">
    ${dayBlocks.join('')}
  </div>
</body>
</html>`;
}

function newFormLine(status: WorkStatus = 'TODO'): FormLine {
  return {
    key: `k-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    area: '',
    assignee_name: '',
    status,
  };
}

/**
 * `/schedule/work-board` — 월간 캘린더 + 일자별 공유 프로젝트 칸반
 * 세부분야 행 상태에 따라 프로젝트 열이 자동 이동
 */
export default function WorkBoardModule() {
  const { year: nowY, month: nowM } = getKSTNowYearMonth();
  const today = getKSTDateString() || ymd(nowY, nowM, 1);

  const [viewYear, setViewYear] = useState(nowY);
  const [viewMonth, setViewMonth] = useState(nowM);
  const [selectedDate, setSelectedDate] = useState(today);
  const [unitName, setUnitName] = useState('');
  const [monthItems, setMonthItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formBoardDate, setFormBoardDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formUrgent, setFormUrgent] = useState(false);
  /** true면 보드 일자 변경 시 마감일도 같이 맞춤 */
  const [dueFollowsBoard, setDueFollowsBoard] = useState(true);
  const [formLines, setFormLines] = useState<FormLine[]>([newFormLine()]);
  const [presetBusy, setPresetBusy] = useState(false);
  /** 카드 세부분야 펼침 */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const monthRange = useMemo(() => {
    const from = ymd(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth, 0).getDate();
    const to = ymd(viewYear, viewMonth, lastDay);
    return { from, to, lastDay };
  }, [viewYear, viewMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/schedule/work-board?from=${monthRange.from}&to=${monthRange.to}&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMonthItems([]);
        setError(String(data.error || '업무 보드를 불러오지 못했습니다.'));
        return;
      }
      setUnitName(String(data.unitName || '').trim());
      setMonthItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setMonthItems([]);
      setError('업무 보드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [monthRange.from, monthRange.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const date = asYmd(selectedDate);
    if (!date) {
      if (selectedDate !== today) setSelectedDate(today);
      return;
    }
    const [y, m] = date.split('-').map(Number);
    if (y && m && (y !== viewYear || m !== viewMonth)) {
      setViewYear(y);
      setViewMonth(m);
    }
  }, [selectedDate, viewYear, viewMonth, today]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    for (const item of monthItems) {
      const span = itemDateSpan(item);
      if (!span) continue;
      let cur = span.start;
      while (cur <= span.end) {
        const list = map.get(cur) || [];
        list.push(item);
        map.set(cur, list);
        const [yy, mm, dd] = cur.split('-').map(Number);
        const next = new Date(yy, mm - 1, dd + 1);
        const nextStr = ymd(next.getFullYear(), next.getMonth() + 1, next.getDate());
        if (nextStr <= cur) break;
        cur = nextStr;
      }
    }
    return map;
  }, [monthItems]);

  const dayItems = useMemo(() => {
    const date = asYmd(selectedDate, today);
    return monthItems.filter((item) => itemCoversDate(item, date));
  }, [monthItems, selectedDate, today]);

  const byStatus = useMemo(() => {
    const map: Record<WorkStatus, WorkItem[]> = { TODO: [], DOING: [], DONE: [] };
    for (const item of dayItems) {
      const lines = Array.isArray(item.lines) ? item.lines : [];
      const key = lines.length
        ? deriveProjectStatus(lines)
        : ((normalizeStatus(item.status) || 'TODO') as WorkStatus);
      map[key].push(item);
    }
    return map;
  }, [dayItems]);

  const holidays = useMemo(() => getKrHolidaysForYear(viewYear), [viewYear]);

  const cells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
    const days: Array<{ dateStr: string; day: number } | null> = [];
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
    () => weeks.map((week) => layoutWorkWeekLanes(week, monthItems)),
    [weeks, monthItems]
  );

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
    const last = new Date(y, m, 0).getDate();
    const cur = asYmd(selectedDate, today);
    const dayNum = Math.min(Number(cur.slice(8, 10)) || 1, last);
    setSelectedDate(ymd(y, m, dayNum));
  };

  const openCreate = (dateStr?: string) => {
    const board = asYmd(dateStr, asYmd(selectedDate, today));
    setSelectedDate(board);
    setEditId(null);
    setFormTitle('');
    setFormNote('');
    setFormBoardDate(board);
    setFormDueDate(board);
    setFormUrgent(false);
    setDueFollowsBoard(true);
    setFormLines([newFormLine('TODO')]);
    setModalOpen(true);
  };

  const openEdit = (item: WorkItem) => {
    const board = item.board_date || selectedDate;
    const due = item.due_date || board;
    setEditId(item.id);
    setFormTitle(item.title || '');
    setFormNote(item.note || '');
    setFormBoardDate(board);
    setFormDueDate(due);
    setFormUrgent(isUrgent(item));
    setDueFollowsBoard(!item.due_date || item.due_date === board);
    const lines = Array.isArray(item.lines) ? item.lines : [];
    setFormLines(
      lines.length
        ? lines.map((l) => ({
            key: l.id || newFormLine().key,
            area: l.area || '',
            assignee_name: l.assignee_name || '',
            status: (normalizeStatus(l.status) || 'TODO') as WorkStatus,
          }))
        : [newFormLine((normalizeStatus(item.status) || 'TODO') as WorkStatus)]
    );
    setModalOpen(true);
  };

  const onBoardDateChange = (next: string) => {
    setFormBoardDate(next);
    if (dueFollowsBoard) setFormDueDate(next);
  };

  const onDueDateChange = (next: string) => {
    setFormDueDate(next);
    setDueFollowsBoard(next === formBoardDate);
  };

  const loadTeamPresets = async () => {
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/schedule/work-board-presets?t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(String(data.error || '목록을 불러오지 못했습니다.'));
        return;
      }
      const presets = Array.isArray(data.presets) ? data.presets : [];
      if (!presets.length) {
        alert('저장된 세부분야·담당자가 없습니다.\n먼저 「저장」으로 남겨 주세요.');
        return;
      }
      setFormLines(
        presets.map((p: { area?: string; assignee_name?: string }) => ({
          key: newFormLine().key,
          area: String(p.area || ''),
          assignee_name: String(p.assignee_name || ''),
          status: 'TODO' as WorkStatus,
        }))
      );
    } finally {
      setPresetBusy(false);
    }
  };

  const saveTeamPresets = async () => {
    const lines = formLines
      .map((l) => ({
        area: l.area.trim(),
        assignee_name: l.assignee_name.trim(),
      }))
      .filter((l) => l.area);
    if (!lines.length) {
      alert('저장할 세부분야가 없습니다.');
      return;
    }
    if (
      !confirm(
        `현재 세부분야·담당자 ${lines.length}행을 소속 공용으로 저장할까요?\n(기존 목록은 이 내용으로 교체됩니다.)`
      )
    ) {
      return;
    }
    setPresetBusy(true);
    try {
      const res = await fetch('/api/schedule/work-board-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(String(data.error || '저장에 실패했습니다.'));
        return;
      }
      alert(`${lines.length}행을 저장했습니다.`);
    } finally {
      setPresetBusy(false);
    }
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditId(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = formTitle.trim();
    const boardDate = formBoardDate.trim();
    if (!title) return;
    if (!boardDate) return alert('보드 일자를 선택해 주세요.');

    const lines = formLines
      .map((l) => ({
        id: l.key.startsWith('k-') ? undefined : l.key,
        area: l.area.trim(),
        assignee_name: l.assignee_name.trim(),
        status: l.status,
      }))
      .filter((l) => l.area || l.assignee_name);

    setSaving(true);
    try {
      const payload = {
        title,
        note: formNote.trim(),
        board_date: boardDate,
        due_date: formDueDate.trim() || null,
        urgent: formUrgent,
        lines,
        ...(editId ? { id: editId } : {}),
      };
      const res = await fetch('/api/schedule/work-board', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(String(data.error || '저장에 실패했습니다.'));
        return;
      }
      setSelectedDate(asYmd(boardDate, today));
      setModalOpen(false);
      setEditId(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const patchLineStatus = async (item: WorkItem, lineId: string, status: WorkStatus) => {
    setSaving(true);
    try {
      const res = await fetch('/api/schedule/work-board', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, line_id: lineId, line_status: status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(String(data.error || '상태 변경에 실패했습니다.'));
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const removeById = async (id: string, title: string) => {
    if (!confirm(`「${title}」 프로젝트를 삭제할까요?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/schedule/work-board?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(String(data.error || '삭제에 실패했습니다.'));
        return;
      }
      setModalOpen(false);
      setEditId(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const previewStatus = useMemo(() => {
    const lines = formLines
      .filter((l) => l.area.trim() || l.assignee_name.trim())
      .map((l) => ({
        id: l.key,
        area: l.area.trim() || '세부',
        assignee_name: l.assignee_name.trim(),
        status: l.status,
      }));
    return deriveProjectStatus(lines);
  }, [formLines]);

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-slate-50 font-sans flex flex-col overflow-hidden">
      <div className="w-full max-w-[1760px] mx-auto flex-1 min-h-0 flex flex-col px-4 md:px-6 pt-5 pb-5 gap-4">
        <header className="shrink-0">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
            Work Board
          </p>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            공유 프로젝트 업무 보드
            {unitName ? (
              <span className="ml-2 text-sm font-normal text-slate-500">· {unitName}</span>
            ) : null}
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-3 underline underline-offset-2"
            >
              다시 시도
            </button>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.35fr)] gap-4 overflow-y-auto xl:overflow-hidden">
          <section className="min-h-0 xl:h-full bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
                  Work Board Calendar
                </p>
                <div className="mt-0.5 flex items-baseline gap-2 min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 shrink-0 tabular-nums">
                    {viewYear}.{pad2(viewMonth)}
                  </h2>
                  <p className="text-[10px] font-normal text-slate-400 truncate min-w-0">
                    날짜를 누르면 프로젝트 보드가 열립니다
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="inline-flex items-stretch rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                  <button
                    type="button"
                    title={`${viewYear}.${pad2(viewMonth)} 인쇄·PDF 다운`}
                    onClick={() => {
                      const stamp = `${viewYear}.${pad2(viewMonth)}`;
                      const html = buildMonthPrintHtml({
                        year: viewYear,
                        month: viewMonth,
                        unitName,
                        items: monthItems,
                        holidays,
                      });
                      openWorkBoardPrint(html, `공유프로젝트-${stamp}`);
                    }}
                    className="h-7 px-2.5 bg-sky-50 text-sky-700 text-[10px] font-medium hover:bg-sky-100 border-r border-slate-200"
                  >
                    ⬇ 월·일정
                  </button>
                  <button
                    type="button"
                    title={`${viewYear}.${pad2(viewMonth)} 엑셀 다운`}
                    onClick={() => {
                      void downloadMonthWorkBoardExcel({
                        year: viewYear,
                        month: viewMonth,
                        unitName,
                        items: monthItems,
                        holidays,
                      }).catch((err) => {
                        console.error('[work-board month excel]', err);
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
              </div>
            </div>

            <div className="p-3.5 flex-1 min-h-0 min-w-0 flex flex-col">
              {loading ? (
                <p className="py-10 text-center text-[12px] font-normal text-slate-400">
                  불러오는 중…
                </p>
              ) : (
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

                  <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                    {weeks.map((week, wi) => {
                      const lanes = weekLayouts[wi] || [];
                      const visibleLanes = lanes.slice(0, MAX_WB_LANES);
                      const hiddenLanes = lanes.slice(MAX_WB_LANES);
                      return (
                        <div
                          key={`week-${wi}`}
                          className="border-t border-slate-200 bg-white flex-1 min-h-0 flex flex-col"
                        >
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
                              const dayList = itemsByDate.get(cell.dateStr) || [];
                              const isSelected = cell.dateStr === selectedDate;
                              const isToday = cell.dateStr === today;
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
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedDate(cell.dateStr);
                                    }
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
                                    {dayList.length > 0 ? (
                                      <span className="text-[9px] font-medium tabular-nums text-slate-400">
                                        ({dayList.length})
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div
                            className="relative grid grid-cols-7 gap-px bg-slate-100 flex-1 min-h-[64px]"
                            style={{
                              minHeight: Math.max(56, visibleLanes.length * (WB_LANE_H + 2) + 16),
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
                                        ? 'bg-indigo-50/90'
                                        : isTodayCell
                                          ? 'bg-indigo-50/30'
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
                                  {renderWbLaneRow(lane, (seg) => {
                                    setSelectedDate(
                                      week[seg.startCol]?.dateStr ||
                                        asYmd(selectedDate, today)
                                    );
                                    openEdit(seg.item);
                                  })}
                                </div>
                              ))}
                              {hiddenLanes.length > 0 ? (
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
                                        className="text-left text-[10px] font-normal text-indigo-500 px-0.5 hover:underline truncate"
                                      >
                                        +{more}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="min-h-0 xl:h-full flex flex-col gap-2 overflow-hidden">
            <div className="shrink-0 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-widest">
                    Selected Day
                  </p>
                  <h2 className="text-[13px] font-semibold text-slate-900 tabular-nums leading-tight inline-flex items-center gap-1.5 flex-wrap">
                    {formatDotDate(asYmd(selectedDate, today))}
                    <span className="text-[11px] font-normal text-slate-500">
                      {dayItems.length}건
                    </span>
                  </h2>
                </div>
                <div className="inline-flex items-stretch rounded-lg border border-slate-200 overflow-hidden shadow-sm shrink-0">
                  <button
                    type="button"
                    title="이 날짜 할 일·진행 중·완료 전체 인쇄·PDF 다운"
                    onClick={() => {
                      const dateStr = asYmd(selectedDate, today);
                      const html = buildDayPrintHtml({
                        dateStr,
                        unitName,
                        items: dayItems,
                      });
                      openWorkBoardPrint(
                        html,
                        `공유프로젝트-${formatDotDate(dateStr)}`
                      );
                    }}
                    className="h-7 px-2.5 bg-sky-50 text-sky-700 text-[10px] font-medium hover:bg-sky-100 border-r border-slate-200"
                  >
                    ⬇ 일·일정
                  </button>
                  <button
                    type="button"
                    title="이 날짜 보드 엑셀 다운"
                    onClick={() => {
                      const dateStr = asYmd(selectedDate, today);
                      void downloadDayWorkBoardExcel({
                        dateStr,
                        unitName,
                        items: dayItems,
                      }).catch((err) => {
                        console.error('[work-board day excel]', err);
                        alert('엑셀 다운로드에 실패했습니다.');
                      });
                    }}
                    className="h-7 px-2.5 bg-emerald-50 text-emerald-700 text-[10px] font-medium hover:bg-emerald-100"
                  >
                    엑셀
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                세부분야 상태가 모두 진행 중이면 진행 중 보드로, 모두 완료면 완료 보드로
                이동합니다. 달력의 월 다운은 월간 일자별, 우측 일 다운은 선택일 보드
                전체입니다.
              </p>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-2 overflow-y-auto md:overflow-hidden">
              {COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className={`flex flex-col min-h-[140px] md:min-h-0 md:h-full rounded-xl border border-slate-200 bg-white overflow-hidden border-t-[3px] ${col.accent}`}
                >
                  <div className="shrink-0 flex items-center justify-between gap-1 px-2.5 py-2 border-b border-slate-100 bg-[#F8F9FA]">
                    <p className="text-[12px] font-semibold text-slate-800 min-w-0 truncate">
                      {col.label}
                      <span className="ml-1 text-[10px] font-normal text-slate-400 uppercase">
                        {col.hint}
                      </span>
                      <span className="ml-1 tabular-nums text-[10px] font-normal text-slate-400">
                        {byStatus[col.key].length}
                      </span>
                    </p>
                    {col.key === 'TODO' ? (
                      <button
                        type="button"
                        onClick={() => openCreate()}
                        disabled={saving}
                        className="shrink-0 h-6 px-2 rounded-md bg-slate-900 text-[10px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        + 프로젝트 추가
                      </button>
                    ) : null}
                  </div>
                  <ul className="flex-1 min-h-0 overflow-y-auto p-1 space-y-1">
                    {byStatus[col.key].length === 0 ? (
                      <li className="py-4 text-center text-[11px] text-slate-400">없음</li>
                    ) : (
                      byStatus[col.key].map((item) => {
                        const lines = Array.isArray(item.lines) ? item.lines : [];
                        const expanded = Boolean(expandedIds[item.id]);
                        return (
                          <li
                            key={item.id}
                            className={`rounded-md border hover:border-rose-300 ${
                              isUrgent(item)
                                ? 'border-rose-300 bg-rose-50'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1 px-1.5 py-1 min-h-[28px]">
                              {lines.length > 0 ? (
                                <button
                                  type="button"
                                  title={expanded ? '세부분야 접기' : '세부분야 펼치기'}
                                  onClick={() =>
                                    setExpandedIds((m) => ({
                                      ...m,
                                      [item.id]: !m[item.id],
                                    }))
                                  }
                                  className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded border text-[12px] font-semibold leading-none ${
                                    expanded
                                      ? 'border-slate-300 bg-slate-100 text-slate-700'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
                                  }`}
                                >
                                  {expanded ? '▼' : '▶'}
                                </button>
                              ) : (
                                <span className="w-6 shrink-0" />
                              )}
                              <button
                                type="button"
                                onClick={() => openEdit(item)}
                                className="min-w-0 flex-1 text-left"
                                title={item.note || item.title}
                              >
                                <span
                                  className={`block truncate text-[12px] font-medium leading-tight ${
                                    isUrgent(item) ? 'text-rose-700' : 'text-slate-900'
                                  }`}
                                >
                                  {item.title}
                                </span>
                              </button>
                              {isUrgent(item) ? (
                                <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold bg-rose-200 text-rose-800">
                                  긴급
                                </span>
                              ) : null}
                            </div>

                            {expanded && lines.length > 0 ? (
                              <ul className="border-t border-slate-100 px-1.5 py-1 space-y-0.5 bg-slate-50/60">
                                {lines.map((line) => (
                                  <li
                                    key={line.id}
                                    className="flex items-center gap-1 min-h-[22px]"
                                  >
                                    <span
                                      className="min-w-0 flex-1 truncate text-[10px] text-slate-700"
                                      title={`${line.area}${line.assignee_name ? ` · ${line.assignee_name}` : ''}`}
                                    >
                                      {line.area}
                                      {line.assignee_name ? (
                                        <span className="text-slate-400">
                                          {' '}
                                          · {line.assignee_name}
                                        </span>
                                      ) : null}
                                    </span>
                                    <select
                                      disabled={saving}
                                      value={normalizeStatus(line.status) || 'TODO'}
                                      onChange={(e) =>
                                        void patchLineStatus(
                                          item,
                                          line.id,
                                          e.target.value as WorkStatus
                                        )
                                      }
                                      className="shrink-0 w-[4.25rem] h-5 rounded border border-slate-200 bg-white px-0.5 text-[9px] text-slate-700 outline-none disabled:opacity-50"
                                    >
                                      {COLUMNS.map((c) => (
                                        <option key={c.key} value={c.key}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/40 p-4">
          <form
            onSubmit={(e) => void submit(e)}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-slate-200 p-5 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                {editId ? '프로젝트 수정' : '공유 프로젝트 추가'}
              </h2>
              <p className="text-[11px] text-slate-500 shrink-0">
                보드 → <span className="font-medium text-slate-800">{STATUS_LABEL[previewStatus]}</span>
              </p>
            </div>

            <div className="flex items-end gap-2">
              <label className="block space-y-1 flex-1 min-w-0">
                <span className="text-[11px] font-medium text-slate-500">공유 프로젝트명</span>
                <input
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400"
                  placeholder="예: A사 제안서, 봄 캠페인"
                />
              </label>
              <button
                type="button"
                onClick={() => setFormUrgent((v) => !v)}
                className={`shrink-0 h-10 px-3 rounded-lg text-[12px] font-semibold border transition-colors ${
                  formUrgent
                    ? 'bg-rose-500 border-rose-500 text-white hover:bg-rose-600'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600'
                }`}
              >
                긴급처리
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">보드 일자</span>
                <input
                  type="date"
                  required
                  value={formBoardDate}
                  onChange={(e) => onBoardDateChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">
                  마감일
                  {dueFollowsBoard ? (
                    <span className="ml-1 font-normal text-slate-400">(보드와 동일)</span>
                  ) : null}
                </span>
                <input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => onDueDateChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-500">메모</span>
              <textarea
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400 resize-y"
                placeholder="세부 내용 (선택)"
              />
            </label>

            <div className="space-y-2 pt-1 border-t border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-slate-500">
                  세부분야 · 담당자 · 상태{' '}
                  <span className="font-normal text-slate-400">(선택)</span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={presetBusy || saving}
                    onClick={() => void loadTeamPresets()}
                    className="h-7 px-2.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    불러오기
                  </button>
                  <button
                    type="button"
                    disabled={presetBusy || saving}
                    onClick={() => void saveTeamPresets()}
                    className="h-7 px-2.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormLines((rows) => [...rows, newFormLine('TODO')])}
                    className="h-7 px-2.5 rounded-md border border-indigo-200 bg-indigo-50 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    + 행 추가
                  </button>
                </div>
              </div>
              <div className="hidden sm:grid grid-cols-[1fr_1fr_6.5rem_2rem] gap-1.5 px-0.5">
                <span className="text-[10px] text-slate-400">세부분야</span>
                <span className="text-[10px] text-slate-400">담당자</span>
                <span className="text-[10px] text-slate-400">상태</span>
                <span />
              </div>
              <ul className="space-y-2">
                {formLines.map((line, idx) => (
                  <li
                    key={line.key}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_6.5rem_2rem] gap-1.5 items-center"
                  >
                    <input
                      value={line.area}
                      onChange={(e) =>
                        setFormLines((rows) =>
                          rows.map((r, i) =>
                            i === idx ? { ...r, area: e.target.value } : r
                          )
                        )
                      }
                      placeholder="세부분야"
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-slate-400"
                    />
                    <input
                      value={line.assignee_name}
                      onChange={(e) =>
                        setFormLines((rows) =>
                          rows.map((r, i) =>
                            i === idx ? { ...r, assignee_name: e.target.value } : r
                          )
                        )
                      }
                      placeholder="담당자"
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-slate-400"
                    />
                    <select
                      value={line.status}
                      onChange={(e) =>
                        setFormLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, status: e.target.value as WorkStatus }
                              : r
                          )
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] outline-none focus:border-slate-400 bg-white"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={formLines.length <= 1}
                      onClick={() =>
                        setFormLines((rows) => rows.filter((_, i) => i !== idx))
                      }
                      className="h-8 w-8 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                      aria-label="행 삭제"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                모두 진행 중 → 진행 중 보드 · 모두 완료 → 완료 보드 · 혼재 시 진행 중 · 모두 할
                일 → 할 일
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              {editId ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void removeById(editId, formTitle.trim() || '프로젝트')}
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  삭제
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-lg px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-100"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving || !formTitle.trim() || !formBoardDate}
                  className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function normalizeStatus(raw: unknown): WorkStatus | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase();
  if (s === 'TODO' || s === 'DOING' || s === 'DONE') return s;
  return null;
}
