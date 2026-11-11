'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CorpCardScaffold from '@/components/asset/corp-card/CorpCardScaffold';
import { CORP_CARD_DEPT_TABS } from '@/lib/interface-step-tabs';
import {
  formatKSTDateTimeMinute,
  getKSTDateString,
  getKSTDateTimeLocal,
  getKSTNowYearMonth,
  getKSTYearMonthParts,
} from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import WindowedPagination from '@/components/common/WindowedPagination';
import DeptAssigneeLine, { useDeptAssignees } from '@/components/common/DeptAssigneeLine';
import {
  DEFAULT_CORP_CARD_GROUPWARE_URL,
  resolveCorpCardGroupwareUrl,
} from '@/lib/corp-card-groupware';
import {
  buildCorpCardHistoryExcelRows,
  buildCorpCardHistoryLedgerTitle,
  writeCorpCardMasterHistoryExcelBuffer,
} from '@/lib/corp-card-history-excel';
import CorpCardOccupancyChart, {
  collectUnitScopeIds,
} from '@/components/asset/corp-card/CorpCardOccupancyChart';
import { isSystemLv1User } from '@/lib/permission-utils';

const CORP_MONITORING_PATH = '/asset/corp-card/master/monitoring';
const CORP_HISTORY_PATH = '/asset/corp-card/master/history';
const CORP_BOARD_PATH = '/asset/corp-card/dept/board';

async function downloadExcelJsFile(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function excelUserLabel(row: {
  userName?: string;
  pickupName?: string;
  pickupType?: string;
  status?: string;
}) {
  const { name, tag } = applicantParts(row);
  return tag ? `${name}(${tag})` : name;
}

function excelReturnConfirmLabel(row: { userConfirmedBy?: string; returnType?: string }) {
  const name = String(row.userConfirmedBy || '').trim();
  if (!name) return '-';
  const kind = String(row.returnType || '').toUpperCase();
  const tag = kind === 'PROXY' ? '대리반납' : kind === 'SELF' ? '수령인반납' : '';
  return tag ? `${name}(${tag})` : name;
}

const SETTINGS_PATH = '/api/asset/corp-card/dept/board/settings';
const GROUPWARE_STORAGE_PREFIX = 'corp_card_groupware_url:';

function groupwareStorageKey(userKey: string) {
  return `${GROUPWARE_STORAGE_PREFIX}${String(userKey || 'anon').trim().toLowerCase()}`;
}

function GroupwareShortcut({
  url,
  onSettings,
  className = '',
  showSettings = true,
}: {
  url: string;
  onSettings?: () => void;
  className?: string;
  showSettings?: boolean;
}) {
  return (
    <span className={`inline-flex items-center flex-wrap gap-1 ${className}`}>
      <span className="text-[11px] font-medium text-amber-800">
        💡 카드 수령 전 그룹웨어 결재는 필수입니다.
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[10px] font-medium bg-sky-600 text-white hover:bg-sky-700"
      >
        법인카드 사용신청서 바로가기
        <span aria-hidden>↗</span>
      </a>
      {showSettings ? (
        <button
          type="button"
          onClick={onSettings}
          aria-label="그룹웨어 바로가기 경로 설정"
          title="개인 경로 설정"
          className="h-6 w-6 rounded-md text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          ⚙
        </button>
      ) : null}
    </span>
  );
}

const BOARD_API_PATH = '/api/asset/corp-card/dept/board';
const MONITORING_API_PATH = '/api/asset/corp-card/master/monitoring';
const MASTER_HISTORY_API_PATH = '/api/asset/corp-card/master/history';
const ACTION_BTN =
  'text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-white text-slate-600 border-slate-200 hover:border-sky-300';
const DISABLED_BTN =
  'text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70';
const CONFIRM_BTN_CHECKOUT =
  'inline-flex items-center justify-center w-[5.25rem] min-w-[5.25rem] px-2 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap border border-amber-500 bg-amber-400 text-slate-900 shadow-sm hover:bg-amber-500 hover:border-amber-600 disabled:opacity-60';
const CONFIRM_BTN_RETURN =
  'inline-flex items-center justify-center w-[5.25rem] min-w-[5.25rem] px-2 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap border border-emerald-400 bg-emerald-200 text-slate-900 shadow-sm hover:bg-emerald-300 hover:border-emerald-500 disabled:opacity-60';
/** 관리담당자 확인 대기 칸 — 반출 앰버 / 반납 뮤트 에메랄드 */
const CONFIRM_CELL_CHECKOUT = 'bg-amber-50';
const CONFIRM_CELL_RETURN = 'bg-emerald-50';
const CARD_ACTION_ON =
  'h-7 rounded-md text-[10px] font-medium bg-yellow-200 text-yellow-950 hover:bg-yellow-100';
const CARD_ACTION_OFF =
  'h-7 rounded-md text-[10px] font-medium bg-white/10 text-white/40 border border-white/10 cursor-not-allowed';

function cardActionClass(enabled: boolean) {
  return enabled ? CARD_ACTION_ON : CARD_ACTION_OFF;
}

type BoardCard = {
  id: string;
  name: string;
  issuer: string;
  last4: string;
  unitId: string;
  unitName: string;
  status: 'ACTIVE' | 'SUSPENDED' | string;
  usageStatus: 'AVAILABLE' | 'RESERVED' | 'CHECKOUT_PENDING' | 'CHECKED_OUT' | 'RETURNING';
  holderName: string;
  openUsageId: string;
};

type BoardItem = {
  id: string;
  cardId: string;
  unitId?: string;
  unitName?: string;
  last4: string;
  cardName: string;
  userId?: string;
  userName: string;
  place: string;
  purpose: string;
  reservedAt: string | null;
  checkoutAt: string | null;
  expectedReturnAt: string | null;
  amount: string;
  returnedAt: string | null;
  userConfirmedBy: string;
  managerConfirmedBy: string;
  managerConfirmedAt?: string | null;
  checkoutConfirmedBy?: string;
  checkoutConfirmedAt?: string | null;
  pickupType?: string;
  pickupName?: string;
  returnType?: string;
  status: string;
  createdAt: string | null;
};

type ActionModal =
  | { kind: 'RESERVE'; card: BoardCard }
  | { kind: 'CHECKOUT'; card: BoardCard }
  | { kind: 'RETURN'; card: BoardCard };

type EditDraft = {
  place: string;
  purpose: string;
  receiveAt: string;
  expectedReturnAt: string;
  amount: string;
  returnedAt: string;
  userConfirmedBy: string;
};

function nowDateTimeLocal() {
  return getKSTDateTimeLocal();
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function parseDateTimeLocal(value: string) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
  if (!m) return { date: '', hour: '00', minute: '00' };
  return { date: m[1], hour: m[2], minute: m[3] };
}

function DateTime24Input({
  value,
  onChange,
  compact,
  combined,
  className = '',
  tone = 'white',
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
  combined?: boolean;
  className?: string;
  tone?: 'white' | 'sky';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const { date, hour, minute } = parseDateTimeLocal(value);
  const emit = (nextDate: string, nextHour: string, nextMinute: string) => {
    if (!nextDate) {
      onChange('');
      return;
    }
    onChange(`${nextDate}T${nextHour}:${nextMinute}`);
  };
  const fill = tone === 'sky' ? 'bg-sky-50' : 'bg-white';
  const field = compact
    ? `h-7 ${fill} border border-slate-200 rounded-md px-1 text-center text-[11px] font-medium outline-none focus:border-sky-500`
    : `h-8 ${fill} border border-slate-200 rounded-lg px-2 text-[11px] font-medium outline-none focus:border-sky-500`;

  useEffect(() => {
    if (!combined || !open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [combined, open]);

  if (combined) {
    const label = date ? `${date} ${hour}:${minute}` : '날짜·시간';
    return (
      <div ref={wrapRef} className={`relative inline-flex justify-center ${className}`}>
        <button
          type="button"
          className={`${field} ${compact ? 'min-w-0 w-full max-w-full px-1' : 'min-w-[148px] w-full px-1.5'}`}
          onClick={() => {
            const el = wrapRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            setPos({ top: r.bottom + 4, left: r.left });
            setOpen((v) => !v);
          }}
        >
          {label}
        </button>
        {open ? (
          <div
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[70] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
          >
            <input
              type="date"
              value={date}
              onChange={(e) => emit(e.target.value, hour, minute)}
              className={`${field} min-w-0 w-[132px]`}
            />
            <select
              value={hour}
              onChange={(e) => emit(date, e.target.value, minute)}
              aria-label="시 (24시간)"
              className={`${field} w-[52px]`}
            >
              {HOURS_24.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-[10px] font-medium text-slate-400 shrink-0">시</span>
            <select
              value={minute}
              onChange={(e) => emit(date, hour, e.target.value)}
              aria-label="분"
              className={`${field} w-[52px]`}
            >
              {MINUTES_60.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="text-[10px] font-medium text-slate-400 shrink-0">분</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="date"
        value={date}
        onChange={(e) => emit(e.target.value, hour, minute)}
        className={`${field} ${compact ? 'min-w-0 w-[118px]' : 'w-[132px]'}`}
      />
      <select
        value={hour}
        onChange={(e) => emit(date, e.target.value, minute)}
        aria-label="시 (24시간)"
        className={`${field} ${compact ? 'w-[42px]' : 'w-[52px]'}`}
      >
        {HOURS_24.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-[10px] font-medium text-slate-400 shrink-0">시</span>
      <select
        value={minute}
        onChange={(e) => emit(date, hour, e.target.value)}
        aria-label="분"
        className={`${field} ${compact ? 'w-[42px]' : 'w-[52px]'}`}
      >
        {MINUTES_60.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <span className="text-[10px] font-medium text-slate-400 shrink-0">분</span>
    </div>
  );
}

function toKstMs(raw?: string | Date | null) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (m) {
    const t = new Date(`${m[1]}T${m[2]}:00+09:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && a1 > b0;
}

function usageWindow(row: BoardItem) {
  if (row.status === 'RETURNING' || row.status === 'CHECKOUT_PENDING' || row.status === 'CHECKED_OUT') {
    const start = toKstMs(row.checkoutAt || row.reservedAt) ?? 0;
    return { start, end: Number.POSITIVE_INFINITY, row };
  }
  if (row.status !== 'RESERVED') return null;
  const start = toKstMs(row.checkoutAt || row.reservedAt);
  if (start == null) return null;
  const end = toKstMs(row.expectedReturnAt || row.returnedAt);
  if (end == null) {
    return { start, end: start, row };
  }
  return { start, end: Math.max(end, start), row };
}

function formatUsageDateTime(value?: string | Date | null) {
  if (value == null || value === '') return '-';
  const s = String(value).trim();
  const wall = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (wall && /Z$/i.test(s)) {
    return `${wall[1]} ${wall[2]}`;
  }
  return formatKSTDateTimeMinute(value);
}

function splitUsageDateTime(value?: string | Date | null) {
  const full = formatUsageDateTime(value);
  if (!full || full === '-') return null;
  const m = full.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };
  return { date: full, time: '' };
}

function UsageDateTimeStack({
  value,
  className = '',
}: {
  value?: string | Date | null;
  className?: string;
}) {
  const parts = splitUsageDateTime(value);
  if (!parts) return <span className={`text-[11px] font-medium ${className}`}>-</span>;
  return (
    <span
      className={`block leading-tight ${className}`}
      title={`${parts.date} ${parts.time}`.trim()}
    >
      <span className="block tabular-nums text-[11px] font-medium">{parts.date}</span>
      {parts.time ? (
        <span className="block tabular-nums text-[10px] font-medium text-slate-500">{parts.time}</span>
      ) : null}
    </span>
  );
}

function ManagerConfirmStamp({
  name,
  at,
}: {
  name: string;
  at?: string | Date | null;
}) {
  const parts = splitUsageDateTime(at);
  const date = parts?.date || '-';
  const time = parts?.time || '';
  return (
    <span className="block leading-tight" title={`${name} ${date}${time ? ` ${time}` : ''}`.trim()}>
      <span className="block tabular-nums text-[11px] font-medium text-slate-700">{date}</span>
      <span className="truncate block text-[10px] font-medium text-sky-700">{name}</span>
    </span>
  );
}

function toDateTimeLocal(value?: string | Date | null) {
  const full = formatUsageDateTime(value);
  if (!full || full === '-') return '';
  return full.replace(' ', 'T');
}

function addKstHours(value: string, hours: number) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (!m) return value;
  const t = new Date(`${m[1]}T${m[2]}:00+09:00`).getTime();
  if (Number.isNaN(t)) return value;
  return getKSTDateTimeLocal(t + hours * 60 * 60 * 1000);
}

function defaultReturnAt(checkoutAt: string) {
  const m = String(checkoutAt || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return checkoutAt;
  const sameDay = `${m[1]}T18:00`;
  if (checkoutAt && sameDay <= checkoutAt) return addKstHours(sameDay, 24);
  return sameDay;
}

function isReturnNotAfter(start: string, end: string) {
  if (!start || !end) return false;
  return end <= start;
}

function formatAmount(raw: string) {
  const digits = String(raw || '').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 15);
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const RETURN_PLAN_HINT = '기본 당일 18시 설정됨, 변경 가능';
const TIME_ORDER_WARNING = '※ 반납 예정 시간은 수령 시간 이후여야 합니다.';

function FieldHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);

  const show = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top - 6, left: r.left + r.width / 2 });
    setOpen(true);
  };

  return (
    <span className="relative inline-flex items-center align-middle">
      <button
        ref={btnRef}
        type="button"
        className="normal-case tracking-normal text-[11px] font-medium text-slate-400 hover:text-sky-600 leading-none px-0.5"
        aria-label={text}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) setOpen(false);
          else show();
        }}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open ? (
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-full w-max max-w-[220px] rounded-md border border-amber-200 bg-amber-100 px-2.5 py-1.5 text-left text-[10px] font-medium leading-snug text-amber-950 normal-case tracking-normal shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

function QuickOffsetRow({
  days,
  hours,
  onChange,
  className = '',
}: {
  days: string;
  hours: string;
  onChange: (days: string, hours: string) => void;
  className?: string;
}) {
  const digits = (raw: string) => raw.replace(/[^\d]/g, '').slice(0, 3);
  const field =
    'h-7 w-10 bg-white border border-slate-200 rounded-md px-1 text-center text-[11px] font-medium outline-none focus:border-sky-500';
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span className="text-[11px] font-medium text-slate-500">간편 설정</span>
      <span className="text-[11px] font-medium text-slate-400">+</span>
      <input
        type="text"
        inputMode="numeric"
        value={days}
        onChange={(e) => {
          const raw = digits(e.target.value);
          const nextHours = hours === '' && raw !== '' ? '0' : hours;
          onChange(raw, nextHours);
        }}
        placeholder="0"
        className={field}
      />
      <span className="text-[11px] font-medium text-slate-600">일</span>
      <span className="text-[11px] font-medium text-slate-400">+</span>
      <input
        type="text"
        inputMode="numeric"
        value={hours}
        onChange={(e) => {
          const raw = digits(e.target.value);
          const nextDays = days === '' && raw !== '' ? '0' : days;
          onChange(nextDays, raw);
        }}
        placeholder="0"
        className={field}
      />
      <span className="text-[11px] font-medium text-slate-600">시간</span>
    </div>
  );
}

function occupancyHolderName(row: {
  status?: string;
  userName?: string;
  pickupName?: string;
  userConfirmedBy?: string;
}) {
  const reservedBy = String(row.userName || '').trim();
  const checkoutBy = String(row.pickupName || '').trim();
  const returnedBy = String(row.userConfirmedBy || '').trim();
  if (row.status === 'RETURNING') return returnedBy || checkoutBy || reservedBy;
  if (row.status === 'CHECKED_OUT' || row.status === 'CHECKOUT_PENDING') return checkoutBy || reservedBy;
  return reservedBy;
}

function pickupDesignationLabel(row: {
  pickupType?: string;
  pickupName?: string;
}) {
  if (String(row.pickupType || '').toUpperCase() === 'PROXY') {
    const name = String(row.pickupName || '').trim();
    return name ? `대리수령(${name})` : '대리수령';
  }
  return '본인수령';
}

function returnDesignationLabel(row: {
  returnType?: string;
  userConfirmedBy?: string;
}) {
  if (String(row.returnType || '').toUpperCase() === 'PROXY') {
    const name = String(row.userConfirmedBy || '').trim();
    return name ? `부서원 지정(${name})` : '부서원 지정';
  }
  return '수령자';
}

function applicantParts(row: {
  userName?: string;
  pickupName?: string;
  pickupType?: string;
  status?: string;
}) {
  const applicant = String(row.userName || '').trim();
  const pickup = String(row.pickupName || '').trim();
  if (row.status === 'RESERVED') {
    if (!applicant) return { name: '-', tag: '' };
    return { name: applicant, tag: '예약자' };
  }
  if (String(row.pickupType || '').toUpperCase() === 'PROXY') {
    const name = pickup || applicant;
    if (!name) return { name: '-', tag: '' };
    return { name, tag: '대리수령' };
  }
  const name = pickup || applicant;
  if (!name) return { name: '-', tag: '' };
  return { name, tag: '' };
}

function ApplicantName({
  row,
  className = '',
}: {
  row: { userName?: string; pickupName?: string; pickupType?: string; status?: string };
  className?: string;
}) {
  const { name, tag } = applicantParts(row);
  const title = tag ? `${name}(${tag})` : name;
  return (
    <span className={`block leading-tight ${className}`} title={title}>
      <span className="block truncate text-[11px] font-medium">{name}</span>
      {tag ? (
        <span
          className={`block text-[10px] font-medium ${
            tag === '예약자' ? 'text-red-700' : tag === '대리수령' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          ({tag})
        </span>
      ) : null}
    </span>
  );
}

function ConfirmedByName({
  name,
  returnType,
}: {
  name?: string;
  returnType?: string;
}) {
  const display = String(name || '').trim();
  if (!display) return <span>-</span>;
  const kind = String(returnType || '').toUpperCase();
  const tag = kind === 'PROXY' ? '대리반납' : kind === 'SELF' ? '수령인반납' : '';
  const title = tag ? `${display}(${tag})` : display;
  return (
    <span className="block leading-tight" title={title}>
      <span className="block truncate text-[11px] font-medium">{display}</span>
      {tag ? (
        <span
          className={`block text-[10px] font-medium ${
            tag === '대리반납' ? 'text-blue-700' : 'text-sky-700'
          }`}
        >
          ({tag})
        </span>
      ) : null}
    </span>
  );
}

function rowStatusLabel(status: string) {
  if (status === 'RESERVED') return '예약중';
  if (status === 'CHECKOUT_PENDING') return '수령 대기중';
  if (status === 'CHECKED_OUT') return '대여중';
  if (status === 'RETURNING') return '반납 대기중';
  return '반납';
}

function rowStatusClass(status: string) {
  const base = 'inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium';
  if (status === 'RESERVED') return `${base} bg-red-100 text-red-700`;
  if (status === 'CHECKOUT_PENDING') return `${base} bg-amber-100 text-amber-800`;
  if (status === 'CHECKED_OUT') return `${base} bg-sky-100 text-blue-700`;
  if (status === 'RETURNING') return `${base} bg-violet-100 text-violet-800`;
  return `${base} text-slate-700`;
}

type MonitoringStatusFilter = 'ALL' | 'CHECKOUT_PENDING' | 'CHECKED_OUT' | 'RETURNING';

const MONITORING_STATUS_CHIPS: {
  id: MonitoringStatusFilter;
  label: string;
  idle: string;
  active: string;
}[] = [
  {
    id: 'ALL',
    label: '전체',
    idle: 'bg-white/10 text-white/80 border-white/20 hover:bg-white/15',
    active: 'bg-white text-slate-800 border-white',
  },
  {
    id: 'CHECKOUT_PENDING',
    label: '수령 대기중',
    idle: 'bg-amber-500/20 text-amber-100 border-amber-400/40 hover:bg-amber-500/30',
    active: 'bg-amber-400 text-amber-950 border-amber-400',
  },
  {
    id: 'CHECKED_OUT',
    label: '대여중',
    idle: 'bg-sky-500/20 text-sky-100 border-sky-400/40 hover:bg-sky-500/30',
    active: 'bg-sky-400 text-sky-950 border-sky-400',
  },
  {
    id: 'RETURNING',
    label: '반납 대기중',
    idle: 'bg-violet-500/20 text-violet-100 border-violet-400/40 hover:bg-violet-500/30',
    active: 'bg-violet-400 text-violet-950 border-violet-400',
  },
];

function usageLabel(card: BoardCard) {
  if (card.status === 'SUSPENDED') return '정지';
  if (card.usageStatus === 'RESERVED') {
    return card.holderName ? `예약중(${card.holderName})` : '예약중';
  }
  if (card.usageStatus === 'CHECKOUT_PENDING') {
    return card.holderName ? `수령 대기중(${card.holderName})` : '수령 대기중';
  }
  if (card.usageStatus === 'CHECKED_OUT') {
    return card.holderName ? `대여중(${card.holderName})` : '대여중';
  }
  if (card.usageStatus === 'RETURNING') {
    return card.holderName ? `반납 대기중(${card.holderName})` : '반납 대기중';
  }
  return '신청가능';
}

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export function BoardPanel({
  variant = 'board',
}: {
  variant?: 'board' | 'monitoring' | 'masterHistory';
}) {
  const isMonitoring = variant === 'monitoring';
  const isMasterHistory = variant === 'masterHistory';
  const isMasterTable = isMonitoring || isMasterHistory;
  const isBoard = variant === 'board';
  const isLedger = isMonitoring || isMasterHistory;
  /** 보드: 카드 + 진행중 표 / 모니터링·마스터이력: 표만 */
  const showProgressTable = isBoard || isLedger;
  /** 부서 보드 진행중 표는 반납 정보(금액·회수·확인) 숨김 */
  const showReturnCols = !isBoard;
  const dataApi = isMasterHistory
    ? MASTER_HISTORY_API_PATH
    : isMonitoring
      ? MONITORING_API_PATH
      : BOARD_API_PATH;
  const actionApi = BOARD_API_PATH;
  const assigneeMenuPath = isMasterHistory
    ? CORP_HISTORY_PATH
    : isMonitoring
      ? CORP_MONITORING_PATH
      : CORP_BOARD_PATH;
  const { editorNames } = useDeptAssignees(assigneeMenuPath);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [myUnitName, setMyUnitName] = useState('');
  const [isLv1, setIsLv1] = useState(false);
  const [historyDeleteBusy, setHistoryDeleteBusy] = useState(false);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [checkoutPlanAt, setCheckoutPlanAt] = useState(() => nowDateTimeLocal());
  const [returnPlanAt, setReturnPlanAt] = useState(() => defaultReturnAt(nowDateTimeLocal()));
  const [planOffsetDays, setPlanOffsetDays] = useState('');
  const [planOffsetHours, setPlanOffsetHours] = useState('');
  const [scheduleCard, setScheduleCard] = useState<BoardCard | null>(null);
  const [checkoutReserveNotice, setCheckoutReserveNotice] = useState<{
    card: BoardCard;
    reservation: BoardItem;
  } | null>(null);
  const [checkoutConfirmRow, setCheckoutConfirmRow] = useState<BoardItem | null>(null);
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [actionAt, setActionAt] = useState('');
  const [actionReturnAt, setActionReturnAt] = useState('');
  const [returnOffsetDays, setReturnOffsetDays] = useState('');
  const [returnOffsetHours, setReturnOffsetHours] = useState('');
  const [actionAmount, setActionAmount] = useState('');
  const [actionPlace, setActionPlace] = useState('');
  const [actionPurpose, setActionPurpose] = useState('');
  const [pickupMode, setPickupMode] = useState<'SELF' | 'PROXY'>('SELF');
  const [pickupMemberId, setPickupMemberId] = useState('');
  const [returnMode, setReturnMode] = useState<'SELF' | 'PROXY'>('SELF');
  const [returnMemberId, setReturnMemberId] = useState('');
  const [deptMembers, setDeptMembers] = useState<
    { id: string; name: string; email: string; unitName: string }[]
  >([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [returnConfirmRow, setReturnConfirmRow] = useState<BoardItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const nowYm = getKSTNowYearMonth();
  const [selectedYear, setSelectedYear] = useState(() => String(nowYm.year));
  const [selectedMonth, setSelectedMonth] = useState(() =>
    variant === 'board' || variant === 'monitoring'
      ? 'ALL'
      : String(nowYm.month).padStart(2, '0')
  );
  const [selectedStatus, setSelectedStatus] = useState<MonitoringStatusFilter>('ALL');
  const [selectedUnit, setSelectedUnit] = useState('ALL');
  const [chartOrgMode, setChartOrgMode] = useState<'DEPT' | 'CENTER' | 'HQ'>('DEPT');
  const [listUnitId, setListUnitId] = useState('');
  const [orgUnits, setOrgUnits] = useState<
    { id: string; unit_name: string; parent_id?: string | null; sort_order?: number; unit_type?: string | null }[]
  >([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(() => new Set());
  const [historyExcelBusy, setHistoryExcelBusy] = useState(false);
  const [actionKebab, setActionKebab] = useState<{ id: string; top: number; left: number } | null>(
    null
  );
  const actionKebabRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 10;
  const [groupwareUrl, setGroupwareUrl] = useState(DEFAULT_CORP_CARD_GROUPWARE_URL);
  const [groupwareEditor, setGroupwareEditor] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');

  const availableYears = useMemo(() => {
    const years = items
      .map((row) => getKSTYearMonthParts(row.reservedAt || row.checkoutAt || row.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [items]);
  const availableMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const availableUnits = useMemo(() => {
    const names = items
      .map((row) => String(row.unitName || '').trim())
      .filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [items]);

  const visibleCards = useMemo(() => {
    const planStart = toKstMs(checkoutPlanAt);
    const planEnd = toKstMs(returnPlanAt);
    const hasPlan = planStart != null && planEnd != null && planEnd >= planStart;
    // 부서 보드: 정지(SUSPENDED) 카드는 회색 표시 없이 목록에서 제외
    const source = isBoard ? cards.filter((card) => card.status !== 'SUSPENDED') : cards;
    return source.map((card) => {
      const windows = items.map(usageWindow).filter((w): w is NonNullable<typeof w> => !!w && w.row.cardId === card.id);
      const checkedOut = windows.find((w) => w.row.status === 'CHECKED_OUT');
      if (checkedOut) {
        return {
          ...card,
          usageStatus: 'CHECKED_OUT' as const,
          holderName: occupancyHolderName(checkedOut.row) || card.holderName,
          openUsageId: checkedOut.row.id,
        };
      }
      const pendingCheckout = windows.find((w) => w.row.status === 'CHECKOUT_PENDING');
      if (pendingCheckout) {
        return {
          ...card,
          usageStatus: 'CHECKOUT_PENDING' as const,
          holderName: occupancyHolderName(pendingCheckout.row) || card.holderName,
          openUsageId: pendingCheckout.row.id,
        };
      }
      const returning = windows.find((w) => w.row.status === 'RETURNING');
      if (returning) {
        return {
          ...card,
          usageStatus: 'RETURNING' as const,
          holderName: occupancyHolderName(returning.row) || card.holderName,
          openUsageId: returning.row.id,
        };
      }
      if (hasPlan) {
        const reserved = windows.find(
          (w) => w.row.status === 'RESERVED' && rangesOverlap(planStart, planEnd, w.start, w.end)
        );
        if (reserved) {
          return {
            ...card,
            usageStatus: 'RESERVED' as const,
            holderName: occupancyHolderName(reserved.row),
            openUsageId: reserved.row.id,
          };
        }
        return { ...card, usageStatus: 'AVAILABLE' as const, holderName: '', openUsageId: '' };
      }
      return card;
    });
  }, [cards, items, checkoutPlanAt, returnPlanAt, isBoard]);

  const filteredItems = useMemo(() => {
    return items.filter((row) => {
      // 부서 보드 표: 반납대기중·반납완료는 마스터 모니터링/이력으로만
      if (isBoard && (row.status === 'RETURNING' || row.status === 'RETURNED')) return false;
      if (isMonitoring && selectedStatus !== 'ALL' && row.status !== selectedStatus) return false;
      const ym = getKSTYearMonthParts(row.reservedAt || row.checkoutAt || row.createdAt);
      if (selectedYear !== 'ALL' && ym?.year !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) return false;
      if (isMasterTable && selectedUnit !== 'ALL' && String(row.unitName || '').trim() !== selectedUnit) {
        return false;
      }
      if (isMasterTable && listUnitId) {
        const scopeIds = collectUnitScopeIds(listUnitId, orgUnits);
        if (!scopeIds.has(String(row.unitId || '').trim())) return false;
      }
      return true;
    });
  }, [
    items,
    selectedYear,
    selectedMonth,
    selectedStatus,
    selectedUnit,
    isMasterTable,
    isMonitoring,
    listUnitId,
    orgUnits,
    isBoard,
  ]);

  const monitoringStatusCounts = useMemo(() => {
    if (!isMonitoring) {
      return { ALL: 0, CHECKOUT_PENDING: 0, CHECKED_OUT: 0, RETURNING: 0 };
    }
    const base = items.filter((row) => {
      const ym = getKSTYearMonthParts(row.reservedAt || row.checkoutAt || row.createdAt);
      if (selectedYear !== 'ALL' && ym?.year !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && ym?.month !== selectedMonth) return false;
      if (selectedUnit !== 'ALL' && String(row.unitName || '').trim() !== selectedUnit) return false;
      if (listUnitId) {
        const scopeIds = collectUnitScopeIds(listUnitId, orgUnits);
        if (!scopeIds.has(String(row.unitId || '').trim())) return false;
      }
      return true;
    });
    return {
      ALL: base.length,
      CHECKOUT_PENDING: base.filter((r) => r.status === 'CHECKOUT_PENDING').length,
      CHECKED_OUT: base.filter((r) => r.status === 'CHECKED_OUT').length,
      RETURNING: base.filter((r) => r.status === 'RETURNING').length,
    };
  }, [isMonitoring, items, selectedYear, selectedMonth, selectedUnit, listUnitId, orgUnits]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
  const paginatedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredItems, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedYear, selectedMonth, selectedStatus, selectedUnit, listUnitId, items.length]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setActionKebab(null);
  }, [currentPage, selectedYear, selectedMonth, selectedStatus, selectedUnit, listUnitId]);

  useEffect(() => {
    setSelectedHistoryIds(new Set());
  }, [selectedYear, selectedMonth, selectedUnit, listUnitId]);

  const pageHistoryIds = useMemo(
    () => (isMasterHistory ? paginatedItems.map((row) => row.id) : []),
    [isMasterHistory, paginatedItems]
  );
  const allPageHistorySelected =
    pageHistoryIds.length > 0 && pageHistoryIds.every((id) => selectedHistoryIds.has(id));
  const toggleHistoryRow = (id: string) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllPageHistory = () => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (allPageHistorySelected) {
        pageHistoryIds.forEach((id) => next.delete(id));
      } else {
        pageHistoryIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleHistoryExcelDownload = async () => {
    if (!isMasterHistory) return;
    const selected =
      selectedHistoryIds.size > 0
        ? filteredItems.filter((item) => selectedHistoryIds.has(item.id))
        : filteredItems;
    if (selected.length === 0) {
      return alert('다운로드할 목록이 없습니다.');
    }

    const rows = buildCorpCardHistoryExcelRows(selected, {
      userLabel: excelUserLabel,
      returnConfirmLabel: excelReturnConfirmLabel,
      dateTime: formatUsageDateTime,
      amount: (value) => formatAmount(String(value ?? '')) || String(value ?? ''),
    });

    const title = buildCorpCardHistoryLedgerTitle({
      year: selectedYear,
      month: selectedMonth,
    });
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');

    setHistoryExcelBusy(true);
    try {
      const buffer = await writeCorpCardMasterHistoryExcelBuffer(rows, {
        year: selectedYear,
        month: selectedMonth,
        sheetName: '사용관리대장',
      });
      await downloadExcelJsFile(buffer, `${safeTitle}_${getKSTDateString()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    } finally {
      setHistoryExcelBusy(false);
    }
  };

  useEffect(() => {
    if (!actionKebab) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (actionKebabRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[data-action-kebab]')) return;
      setActionKebab(null);
    };
    const onWin = () => setActionKebab(null);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onWin, true);
    window.addEventListener('resize', onWin);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onWin, true);
      window.removeEventListener('resize', onWin);
    };
  }, [actionKebab]);

  const load = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [res, unitRes] = await Promise.all([
        fetch(`${dataApi}?t=${ts}`, { cache: 'no-store' }),
        isMasterTable
          ? fetch(`/api/admin/units?active=true&t=${ts}`, { cache: 'no-store' })
          : Promise.resolve(null),
      ]);
      if (!res.ok) {
        setCards([]);
        setItems([]);
        setLoadError(
          await readApiError(
            res,
            isMasterHistory
              ? '법인카드 반납 이력을 불러오지 못했습니다.'
              : isMonitoring
                ? '법인카드 모니터링을 불러오지 못했습니다.'
                : '법인카드 보드를 불러오지 못했습니다.'
          )
        );
        return;
      }
      const data = await res.json();
      setCards(Array.isArray(data.cards) ? data.cards : []);
      setItems(Array.isArray(data.items) ? data.items : []);
      setCanEdit(Boolean(data.canEdit));
      {
        const fromApi = String(data.myUnitName || '').trim();
        const fromCards = Array.from(
          new Set(
            (Array.isArray(data.cards) ? data.cards : [])
              .map((c: BoardCard) => String(c.unitName || '').trim())
              .filter(Boolean)
          )
        );
        setMyUnitName(fromApi || fromCards[0] || '');
      }
      if (typeof data.isLv1 === 'boolean') setIsLv1(Boolean(data.isLv1));
      if (unitRes?.ok) {
        const rows = await unitRes.json();
        setOrgUnits(Array.isArray(rows) ? rows : []);
      }
    } catch {
      setLoadError('네트워크 오류로 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [isMonitoring, isMasterHistory]);

  useEffect(() => {
    if (!isMasterHistory) return;
    let cancelled = false;
    fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        if (cancelled) return;
        setIsLv1(isSystemLv1User(user));
      })
      .catch(() => {
        if (!cancelled) setIsLv1(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isMasterHistory]);

  const handleHistoryLv1Delete = async () => {
    if (!isMasterHistory) return;
    if (!isLv1) return alert('영구 삭제 권한이 없습니다. (LV_1 전용)');
    const ids = Array.from(selectedHistoryIds);
    if (ids.length === 0) return alert('체크박스로 삭제할 이력을 선택해 주세요.');
    if (
      !confirm(
        `선택한 ${ids.length}건의 반납 이력을 영구 삭제하시겠습니까? (LV_1)\n이 작업은 데이터베이스에서 완전히 파기되며 되돌릴 수 없습니다.`
      )
    ) {
      return;
    }
    setHistoryDeleteBusy(true);
    try {
      const res = await fetch(MASTER_HISTORY_API_PATH, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return alert(String(data.error || '이력 삭제에 실패했습니다.'));
      }
      setSelectedHistoryIds(new Set());
      await load();
      alert(`영구 삭제되었습니다. (${Number(data.deleted) || ids.length}건)`);
    } catch {
      alert('삭제 중 통신 오류가 발생했습니다.');
    } finally {
      setHistoryDeleteBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const applyStored = (email: string) => {
      if (!email) return;
      try {
        const stored = localStorage.getItem(groupwareStorageKey(email));
        if (stored) setGroupwareUrl(resolveCorpCardGroupwareUrl(stored));
      } catch {
        /* ignore */
      }
    };
    fetch(`${SETTINGS_PATH}?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const email = String(data.userEmail || '').trim();
        if (email) {
          setUserEmail(email);
          applyStored(email);
        }
        const url = String(data.groupwareShortcutUrl || '').trim();
        if (!url) return;
        const next = resolveCorpCardGroupwareUrl(url);
        setGroupwareUrl(next);
        if (email) {
          try {
            localStorage.setItem(groupwareStorageKey(email), next);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveGroupware = async () => {
    if (groupwareEditor == null) return;
    const next = resolveCorpCardGroupwareUrl(groupwareEditor);
    setGroupwareUrl(next);
    if (userEmail) {
      try {
        localStorage.setItem(groupwareStorageKey(userEmail), next);
      } catch {
        /* ignore */
      }
    }
    try {
      const res = await fetch(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupwareShortcutUrl: next }),
      });
      if (!res.ok) {
        alert(await readApiError(res, '서버 저장에 실패했습니다. 이 PC에는 저장했습니다.'));
      }
    } catch {
      alert('이 PC에는 저장했습니다. 서버 반영은 실패했습니다.');
    }
    setGroupwareEditor(null);
  };

  useEffect(() => {
    const now = nowDateTimeLocal();
    if (now) {
      setCheckoutPlanAt(now);
      setReturnPlanAt(defaultReturnAt(now));
    }
  }, []);

  const postAction = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(actionApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        alert(await readApiError(res, '처리를 완료하지 못했습니다.'));
        return false;
      }
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  };

  const patchRow = async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(actionApi, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) {
      alert(await readApiError(res, '수정에 실패했습니다.'));
      return false;
    }
    await load();
    return true;
  };

  const startEdit = (row: BoardItem) => {
    if (isMasterTable) return;
    if (row.status === 'RETURNED' || row.status === 'RETURNING') return;
    setEditingId(row.id);
    setDraft({
      place: row.place || '',
      purpose: row.purpose || '',
      receiveAt: toDateTimeLocal(row.checkoutAt || row.reservedAt),
      expectedReturnAt: toDateTimeLocal(row.expectedReturnAt || row.reservedAt),
      amount: formatAmount(row.amount),
      returnedAt: toDateTimeLocal(row.returnedAt),
      userConfirmedBy: row.userConfirmedBy || '',
    });
  };

  const handleSaveEdit = async (row: BoardItem) => {
    if (!draft) return;
    if (row.status === 'RETURNED' || row.status === 'RETURNING') return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (!isMasterTable) {
        patch.place = draft.place;
        patch.purpose = draft.purpose;
      }
      if (row.status === 'RESERVED' && !row.checkoutAt) {
        patch.reservedAt = draft.receiveAt || null;
      }
      // 대여중은 반납예정일 고정 — 예약·반출대기중만 수정
      if (row.status !== 'CHECKED_OUT') {
        patch.expectedReturnAt = draft.expectedReturnAt || null;
      }
      // 반출신청·대여중 수령일자는 마스터 반출확인으로만 확정
      const ok = await patchRow(row.id, patch);
      if (ok) {
        setEditingId(null);
        setDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelReserve = async (row: BoardItem) => {
    if (isMasterTable) {
      if (row.status !== 'CHECKOUT_PENDING') {
        return alert('수령 대기중인 건만 취소할 수 있습니다.');
      }
    } else if (row.status !== 'RESERVED' && row.status !== 'CHECKOUT_PENDING') {
      return alert('예약·수령 대기중인 건만 취소할 수 있습니다.');
    }
    if (
      !confirm(
        isMasterTable
          ? '이 수령 신청을 취소할까요? 카드가 다시 신청가능 상태가 됩니다.'
          : row.status === 'CHECKOUT_PENDING'
            ? '이 수령 신청을 취소할까요? 카드가 다시 신청가능 상태가 됩니다.'
            : '이 예약을 취소할까요? 카드가 다시 신청가능 상태가 됩니다.'
      )
    ) {
      return;
    }
    const ok = await postAction({ action: 'CANCEL_RESERVE', id: row.id });
    if (ok && editingId === row.id) {
      setEditingId(null);
      setDraft(null);
    }
  };

  const handleReserve = (card: BoardCard) => {
    if (card.status === 'SUSPENDED') return alert('정지된 카드입니다.');
    if (card.usageStatus !== 'AVAILABLE') return alert('지금은 예약할 수 없는 카드입니다.');
    if (!checkoutPlanAt) return alert('수령 예정 일시를 선택해 주세요.');
    if (!returnPlanAt) return alert('반납 예정 일시를 선택해 주세요.');
    setActionPlace('');
    setActionPurpose('');
    setActionAmount('');
    setActionAt('');
    setActionModal({ kind: 'RESERVE', card });
  };

  const applyReturnQuick = (daysRaw: string, hoursRaw: string, fromAt = actionAt) => {
    const days = daysRaw === '' ? 0 : Number(daysRaw);
    const hours = hoursRaw === '' ? 0 : Number(hoursRaw);
    if (!Number.isFinite(days) || !Number.isFinite(hours)) return;
    setActionReturnAt(addKstHours(fromAt || nowDateTimeLocal(), days * 24 + hours));
  };

  const handleConfirmManager = (row: BoardItem) => {
    if (!canEdit) return alert('모니터링 편집 권한이 없습니다.');
    if (row.status !== 'RETURNING') return alert('반납 대기중인 건만 담당자확인할 수 있습니다.');
    setReturnConfirmRow(row);
  };

  const submitConfirmManager = async () => {
    if (!returnConfirmRow) return;
    if (returnConfirmRow.status !== 'RETURNING') {
      setReturnConfirmRow(null);
      return alert('반납 대기중인 건만 담당자확인할 수 있습니다.');
    }
    const ok = await postAction({ action: 'CONFIRM_MANAGER', id: returnConfirmRow.id });
    if (ok) setReturnConfirmRow(null);
  };

  const handleConfirmCheckout = (row: BoardItem) => {
    if (!canEdit) return alert('모니터링 편집 권한이 없습니다.');
    if (row.status !== 'CHECKOUT_PENDING') return alert('반출 대기중인 건만 반출확인할 수 있습니다.');
    setCheckoutConfirmRow(row);
  };

  const submitConfirmCheckout = async () => {
    if (!checkoutConfirmRow) return;
    if (checkoutConfirmRow.status !== 'CHECKOUT_PENDING') {
      setCheckoutConfirmRow(null);
      return alert('반출 대기중인 건만 반출확인할 수 있습니다.');
    }
    const ok = await postAction({ action: 'CONFIRM_CHECKOUT', id: checkoutConfirmRow.id });
    if (ok) setCheckoutConfirmRow(null);
  };

  const loadDeptMembers = async () => {
    setMembersLoading(true);
    try {
      const res = await fetch(`${BOARD_API_PATH}/members`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeptMembers([]);
        return;
      }
      setDeptMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      setDeptMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const beginCheckoutForm = (card: BoardCard, open?: BoardItem | null) => {
    const receiveAt = nowDateTimeLocal();
    const reservedReturn = toDateTimeLocal(open?.expectedReturnAt);
    setActionAt(receiveAt);
    setActionReturnAt(reservedReturn || defaultReturnAt(receiveAt));
    setReturnOffsetDays('');
    setReturnOffsetHours('');
    setActionPlace(open?.place || '');
    setActionPurpose(open?.purpose || '');
    setActionAmount('');
    setPickupMode('SELF');
    setPickupMemberId('');
    setCheckoutReserveNotice(null);
    setActionModal({ kind: 'CHECKOUT', card });
    void loadDeptMembers();
  };

  const openCheckout = (card: BoardCard) => {
    if (card.status === 'SUSPENDED') return alert('정지된 카드입니다.');
    if (
      card.usageStatus === 'CHECKED_OUT' ||
      card.usageStatus === 'CHECKOUT_PENDING' ||
      card.usageStatus === 'RETURNING'
    ) {
      return alert(
        card.usageStatus === 'RETURNING'
          ? '반납 대기중인 카드입니다.'
          : card.usageStatus === 'CHECKOUT_PENDING'
            ? '수령 대기중인 카드입니다.'
            : '이미 대여 중인 카드입니다.'
      );
    }
    const open = items.find((row) => row.id === card.openUsageId);
    const reservation =
      open?.status === 'RESERVED'
        ? open
        : items.find((row) => row.cardId === card.id && row.status === 'RESERVED') || null;
    if (reservation) {
      setCheckoutReserveNotice({ card, reservation });
      return;
    }
    beginCheckoutForm(card, open);
  };

  const openReturn = (card: BoardCard) => {
    if (card.usageStatus !== 'CHECKED_OUT') return alert('대여 중인 카드만 반납할 수 있습니다.');
    const open =
      items.find((row) => row.id === card.openUsageId && row.status === 'CHECKED_OUT') ||
      items.find((row) => row.cardId === card.id && row.status === 'CHECKED_OUT') ||
      null;
    setActionAt(nowDateTimeLocal());
    setActionAmount('');
    setActionPlace(open?.place || '');
    setActionPurpose(open?.purpose || '');
    setReturnMode('SELF');
    setReturnMemberId('');
    setActionModal({ kind: 'RETURN', card });
    void loadDeptMembers();
  };

  const submitModal = async () => {
    if (!actionModal) return;
    if (actionModal.kind === 'RESERVE') {
      if (isReturnNotAfter(checkoutPlanAt, returnPlanAt)) return;
      const ok = await postAction({
        action: 'RESERVE',
        cardId: actionModal.card.id,
        reservedAt: checkoutPlanAt,
        expectedReturnAt: returnPlanAt,
        place: actionPlace.trim(),
        purpose: actionPurpose.trim(),
      });
      if (ok) setActionModal(null);
      return;
    }
    if (actionModal.kind === 'RETURN') {
      void submitReturn();
    }
  };

  const submitCheckout = async () => {
    if (!actionModal || actionModal.kind !== 'CHECKOUT') return;
    const place = actionPlace.trim();
    const purpose = actionPurpose.trim();
    if (!actionAt) return alert('수령 일시를 선택해 주세요.');
    if (!actionReturnAt) return alert('반납 예정일을 선택해 주세요.');
    if (!place) return alert('사용처를 입력해 주세요.');
    if (!purpose) return alert('사용목적을 입력해 주세요.');
    if (isReturnNotAfter(actionAt, actionReturnAt)) return;
    const pickupType = pickupMode;
    let pickupName: string | undefined;
    if (pickupType === 'PROXY') {
      const member = deptMembers.find((m) => m.id === pickupMemberId);
      if (!member?.name) return alert('대리 수령자를 선택해 주세요.');
      pickupName = member.name;
    }
    const ok = await postAction({
      action: 'CHECKOUT',
      cardId: actionModal.card.id,
      checkoutAt: actionAt,
      reservedAt: checkoutPlanAt,
      expectedReturnAt: actionReturnAt,
      place,
      purpose,
      pickupType,
      ...(pickupName ? { pickupName } : {}),
    });
    if (ok) setActionModal(null);
  };

  const submitReturn = async () => {
    if (!actionModal || actionModal.kind !== 'RETURN') return;
    const place = actionPlace.trim();
    const purpose = actionPurpose.trim();
    if (!actionAt) return alert('반납 일시를 선택해 주세요.');
    if (!formatAmount(actionAmount)) return alert('사용금액을 입력해 주세요.');
    if (!place) return alert('사용처를 입력해 주세요.');
    if (!purpose) return alert('사용목적을 입력해 주세요.');
    const returnType = returnMode;
    let returnName: string | undefined;
    if (returnType === 'PROXY') {
      const member = deptMembers.find((m) => m.id === returnMemberId);
      if (!member?.name) return alert('대리 반납자를 선택해 주세요.');
      returnName = member.name;
    }
    const ok = await postAction({
      action: 'RETURN',
      cardId: actionModal.card.id,
      returnedAt: actionAt,
      amount: formatAmount(actionAmount),
      place,
      purpose,
      returnType,
      ...(returnName ? { returnName } : {}),
    });
    if (ok) setActionModal(null);
  };

  const checkoutReady =
    Boolean(actionAt) &&
    Boolean(actionReturnAt) &&
    actionPlace.trim().length > 0 &&
    actionPurpose.trim().length > 0;
  const reserveTimeInvalid = isReturnNotAfter(checkoutPlanAt, returnPlanAt);
  const checkoutTimeInvalid = isReturnNotAfter(actionAt, actionReturnAt);
  const checkoutSubmitDisabled = Boolean(
    actionModal?.kind === 'CHECKOUT' &&
      (!checkoutReady ||
        checkoutTimeInvalid ||
        (pickupMode === 'PROXY' && !pickupMemberId))
  );
  const reserveSubmitDisabled = Boolean(actionModal?.kind === 'RESERVE' && reserveTimeInvalid);
  const returnReady =
    Boolean(actionAt) &&
    Boolean(formatAmount(actionAmount)) &&
    actionPlace.trim().length > 0 &&
    actionPurpose.trim().length > 0;
  const returnSubmitDisabled = Boolean(
    actionModal?.kind === 'RETURN' &&
      (!returnReady || (returnMode === 'PROXY' && !returnMemberId))
  );
  const actionSubmitDisabled = checkoutSubmitDisabled || reserveSubmitDisabled || returnSubmitDisabled;
  const showTimeOrderWarning =
    (actionModal?.kind === 'RESERVE' && reserveTimeInvalid) ||
    (actionModal?.kind === 'CHECKOUT' && checkoutTimeInvalid);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-medium">
          ⚠️ {loadError}
        </div>
      ) : null}

      {!isLedger ? (
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
              이용 가능 카드 조회
            </h2>
            <GroupwareShortcut
              url={groupwareUrl}
              onSettings={() => setGroupwareEditor(groupwareUrl)}
              className="justify-end"
            />
          </div>
          <div className="flex flex-wrap items-end gap-4 mt-3">
            <div>
              <label className="text-sm font-medium text-slate-900 block mb-1">수령 예정 일시</label>
              <DateTime24Input
                tone="sky"
                value={checkoutPlanAt}
                onChange={(next) => {
                  setCheckoutPlanAt(next);
                  if (planOffsetDays !== '' || planOffsetHours !== '') {
                    const days = planOffsetDays === '' ? 0 : Number(planOffsetDays);
                    const hours = planOffsetHours === '' ? 0 : Number(planOffsetHours);
                    if (Number.isFinite(days) && Number.isFinite(hours)) {
                      setReturnPlanAt(addKstHours(next, days * 24 + hours));
                    }
                    return;
                  }
                  setReturnPlanAt(defaultReturnAt(next));
                }}
              />
            </div>
            <span className="text-slate-400 text-xs font-medium pb-1.5">~</span>
            <div>
              <label className="text-sm font-medium text-slate-900 inline-flex items-center mb-1">
                반납 예정 일시
                <FieldHint text={RETURN_PLAN_HINT} />
                {reserveTimeInvalid ? (
                  <span className="ml-1.5 text-[11px] font-medium text-rose-600 whitespace-nowrap">
                    {TIME_ORDER_WARNING}
                  </span>
                ) : null}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <DateTime24Input tone="sky" value={returnPlanAt} onChange={setReturnPlanAt} />
                <span className="w-px h-5 bg-slate-300 mx-2 shrink-0" aria-hidden />
                <QuickOffsetRow
                  days={planOffsetDays}
                  hours={planOffsetHours}
                  onChange={(days, hours) => {
                    setPlanOffsetDays(days);
                    setPlanOffsetHours(hours);
                    if (days === '' && hours === '') return;
                    const d = days === '' ? 0 : Number(days);
                    const h = hours === '' ? 0 : Number(hours);
                    if (!Number.isFinite(d) || !Number.isFinite(h)) return;
                    setReturnPlanAt(addKstHours(checkoutPlanAt, d * 24 + h));
                  }}
                />
              </div>
            </div>
          </div>
          <p className="text-[10px] font-medium text-slate-400 mt-2">
            시간을 바꾸면 아래 카드의 예약신청가능·예약중 상태가 바로 맞춰집니다. 카드를 클릭하면
            예약·대여 현황을 볼 수 있습니다.
          </p>
        </div>
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleCards.length === 0 ? (
              <div
                className="rounded-xl p-4 min-h-[148px] border border-dashed border-slate-300 bg-slate-50 flex flex-col justify-center items-center text-center"
                aria-live="polite"
              >
                <p className="text-[10px] font-medium text-slate-400">법인카드</p>
                <p className="mt-3 text-sm font-medium text-slate-500">등록된 카드가 없습니다.</p>
              </div>
            ) : (
              visibleCards.map((card) => {
                const occupied =
                  card.usageStatus === 'CHECKED_OUT' ||
                  card.usageStatus === 'CHECKOUT_PENDING' ||
                  card.usageStatus === 'RETURNING';
                const canReserve = card.usageStatus === 'AVAILABLE';
                const canCheckout = !occupied;
                const canReturn = card.usageStatus === 'CHECKED_OUT';
                const statusText = usageLabel(card);
                return (
                  <div
                    key={card.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setScheduleCard(card)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setScheduleCard(card);
                      }
                    }}
                    className="rounded-xl p-4 text-white shadow-sm border cursor-pointer bg-gradient-to-br from-sky-600 to-sky-800 border-sky-700"
                  >
                    <p className="text-[10px] font-medium text-white/70 truncate" title={card.unitName}>
                      {card.unitName ? `${card.unitName} 법인카드` : '법인카드'}
                    </p>
                    <p className="text-sm font-medium truncate mt-0.5" title={card.name}>
                      {card.name}
                    </p>
                    <p className="text-[13px] font-medium tracking-[0.18em] mt-2">{card.last4}</p>
                    <span
                      className={`inline-flex mt-2 px-2 py-0.5 rounded-md text-[10px] font-medium ${
                        card.usageStatus === 'CHECKED_OUT'
                          ? 'bg-sky-100 text-blue-700'
                          : card.usageStatus === 'CHECKOUT_PENDING'
                            ? 'bg-amber-100 text-amber-800'
                          : card.usageStatus === 'RETURNING'
                            ? 'bg-violet-100 text-violet-800'
                          : card.usageStatus === 'RESERVED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {statusText}
                    </span>
                    <div className="grid grid-cols-3 gap-1 mt-3">
                      <button
                        type="button"
                        disabled={saving || !canReserve}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReserve(card);
                        }}
                        className={cardActionClass(canReserve && !saving)}
                      >
                        예약
                      </button>
                      <button
                        type="button"
                        disabled={saving || !canCheckout}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCheckout(card);
                        }}
                        className={cardActionClass(canCheckout && !saving)}
                      >
                        수령
                      </button>
                      <button
                        type="button"
                        disabled={saving || !canReturn}
                        onClick={(e) => {
                          e.stopPropagation();
                          openReturn(card);
                        }}
                        className={cardActionClass(canReturn && !saving)}
                      >
                        반납
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      ) : null}

      {showProgressTable ? (
      <>
      {isMonitoring ? (
        <CorpCardOccupancyChart
          cards={cards}
          items={items}
          units={orgUnits}
          chartOrgMode={chartOrgMode}
          onChartOrgMode={setChartOrgMode}
          listUnitId={listUnitId}
          onListUnitId={(unitId) => {
            setListUnitId(unitId);
            if (unitId) setSelectedUnit('ALL');
          }}
        />
      ) : null}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 px-6 bg-zinc-700 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-300" />
            <h2 className="text-sm font-medium text-white tracking-tight">
              {isMasterHistory
                ? '법인카드 사용관리 대장'
                : isMonitoring
                  ? '전사 진행 중 내역'
                  : myUnitName
                    ? `${myUnitName} 부서법인카드 이용 진행 내역`
                    : '부서법인카드 이용 진행 내역'}
            </h2>
            <span className="text-[11px] font-medium bg-white/15 text-white px-2 py-0.5 rounded-md">
              {filteredItems.length}건
            </span>
            {isMasterTable ? (
              <DeptAssigneeLine editorNames={editorNames} onColor />
            ) : null}
          </div>
          <div className="soh-filter-bar flex items-center gap-2 flex-wrap">
            {isMonitoring ? (
              <div
                className="flex items-center gap-1.5 flex-wrap"
                role="tablist"
                aria-label="상태 빠른 필터"
              >
                {MONITORING_STATUS_CHIPS.map((chip) => {
                  const active = selectedStatus === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSelectedStatus(chip.id)}
                      className={`h-7 px-2.5 rounded-md text-[10px] font-medium border transition-colors whitespace-nowrap ${
                        active ? chip.active : chip.idle
                      }`}
                    >
                      {chip.label}
                      <span className="ml-1 tabular-nums opacity-80">
                        {monitoringStatusCounts[chip.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {isMasterHistory && isLv1 ? (
              <button
                type="button"
                disabled={historyDeleteBusy || selectedHistoryIds.size === 0}
                onClick={() => void handleHistoryLv1Delete()}
                title={
                  selectedHistoryIds.size === 0
                    ? '체크박스로 삭제할 이력을 선택해 주세요'
                    : '체크한 반납 이력 영구 삭제 — LV_1 전용'
                }
                className={`h-7 px-2.5 rounded-md text-[10px] font-medium border whitespace-nowrap transition-colors ${
                  selectedHistoryIds.size > 0 && !historyDeleteBusy
                    ? 'bg-white text-rose-600 border-rose-200 hover:bg-rose-50'
                    : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-70'
                }`}
              >
                {historyDeleteBusy
                  ? '삭제 중…'
                  : selectedHistoryIds.size > 0
                    ? `삭제(LV_1) ${selectedHistoryIds.size}`
                    : '삭제(LV_1)'}
              </button>
            ) : null}
            <div className="flex items-center gap-1.5 bg-white px-2.5 rounded-lg border border-slate-200 shadow-sm h-7 box-border">
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">연도</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}년
                  </option>
                ))}
              </select>
              <div className="w-px h-3 bg-slate-300 shrink-0" />
              <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">월별</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0"
              >
                <option value="ALL">전체</option>
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {Number(month)}월
                  </option>
                ))}
              </select>
              {isMasterTable ? (
                <>
                  <div className="w-px h-3 bg-slate-300 shrink-0" />
                  <span className="text-[10px] font-medium text-slate-400 uppercase leading-none">부서</span>
                  <select
                    value={selectedUnit}
                    onChange={(e) => setSelectedUnit(e.target.value)}
                    className="text-[11px] font-medium text-slate-800 outline-none cursor-pointer bg-transparent h-4 leading-none py-0 max-w-[140px]"
                  >
                    <option value="ALL">전체</option>
                    {availableUnits.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
            {isMasterHistory ? (
              <button
                type="button"
                onClick={() => void handleHistoryExcelDownload()}
                disabled={historyExcelBusy || filteredItems.length === 0}
                title={
                  selectedHistoryIds.size > 0
                    ? `선택한 ${selectedHistoryIds.size}건 다운로드`
                    : '체크가 없으면 현재 필터의 전체 목록을 받습니다'
                }
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-medium shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap disabled:opacity-50"
              >
                {historyExcelBusy
                  ? 'EXCEL 준비 중…'
                  : `목록 EXCEL 다운로드${
                      selectedHistoryIds.size > 0 ? `(${selectedHistoryIds.size})` : ''
                    }`}
              </button>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-hidden">
          <table className="w-full table-fixed text-center border-collapse min-w-0">
            <colgroup>
              {isMasterHistory ? <col style={{ width: '3%' }} /> : null}
              <col style={{ width: isMasterHistory ? '4%' : '2%' }} />
              <col style={{ width: isMasterTable ? '7%' : isBoard ? '6%' : '5%' }} />
              <col style={{ width: isMasterTable ? '6%' : isBoard ? '8%' : '6%' }} />
              <col style={{ width: isMasterTable ? '11%' : isBoard ? '18%' : '15%' }} />
              <col style={{ width: isMasterTable ? '11%' : isBoard ? '18%' : '15%' }} />
              {/* 수령일자 · 반납예정일 — 동일 너비 */}
              <col style={{ width: isMasterTable ? '8%' : isBoard ? '12%' : '11%' }} />
              <col style={{ width: isMasterTable ? '8%' : isBoard ? '12%' : '11%' }} />
              {isMasterTable ? <col style={{ width: '9%' }} /> : null}
              {showReturnCols ? (
                <>
                  <col style={{ width: isMasterTable ? '5%' : '5%' }} />
                  {/* 회수일자 — 반납예정일과 동일 너비 */}
                  <col style={{ width: isMasterTable ? '8%' : '6%' }} />
                  <col style={{ width: isMasterTable ? '6%' : '6%' }} />
                  {isMasterTable ? <col style={{ width: '9%' }} /> : null}
                </>
              ) : null}
              <col style={{ width: isMasterTable ? '6%' : isBoard ? '8%' : '6%' }} />
              {!isMasterHistory ? (
                <col style={{ width: isMasterTable ? '44px' : isBoard ? '12%' : '9%' }} />
              ) : null}
            </colgroup>
            <thead className="text-[11px] font-medium border-b border-slate-200">
              <tr>
                {isMasterHistory ? (
                  <th
                    rowSpan={2}
                    className="h-12 px-1 bg-slate-100 text-slate-700 border-r border-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={allPageHistorySelected}
                      onChange={toggleAllPageHistory}
                      disabled={pageHistoryIds.length === 0}
                      className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                      title="현재 페이지 전체 선택"
                      aria-label="현재 페이지 전체 선택"
                    />
                  </th>
                ) : null}
                <th
                  rowSpan={2}
                  className="h-12 px-1 bg-slate-100 text-slate-700 border-r border-slate-200"
                >
                  NO
                </th>
                <th rowSpan={2} className="h-12 px-2 bg-slate-100 text-slate-700 border-r border-slate-200">
                  {isMasterTable ? '카드·부서' : '카드번호'}
                </th>
                <th
                  colSpan={isMasterTable ? 6 : 5}
                  className="h-8 px-2 bg-slate-100 text-slate-700 border-r border-b border-slate-200"
                >
                  {isBoard ? '수령 정보' : '반출 정보'}
                </th>
                {showReturnCols ? (
                  <th
                    colSpan={isMasterTable ? 4 : 3}
                    className="h-8 px-2 bg-slate-100 text-slate-700 border-r border-b border-slate-200"
                  >
                    반납 정보
                  </th>
                ) : null}
                <th
                  rowSpan={2}
                  className={`h-12 px-2 bg-slate-100 text-slate-700 ${
                    isMasterHistory ? '' : 'border-r border-slate-200'
                  }`}
                >
                  상태
                </th>
                {!isMasterHistory ? (
                  <th rowSpan={2} className="h-12 px-1 bg-slate-100 text-slate-700">
                    {isMasterTable ? '액션' : '관리액션'}
                  </th>
                ) : null}
              </tr>
              <tr className="bg-slate-100 text-slate-700">
                <th className="h-10 px-2 border-t border-slate-200">사용자</th>
                <th className="h-10 px-2 border-t border-slate-200">사용처</th>
                <th className="h-10 px-2 border-t border-slate-200">사용목적</th>
                <th className="h-10 px-2 border-t border-slate-200">수령일자</th>
                <th className="h-10 px-2 border-t border-r border-slate-200">반납예정일</th>
                {isMasterTable ? (
                  <th className="h-10 px-2 border-t border-r border-slate-200">
                    {isMasterHistory ? '관리담당자 확인' : '관리담당자 확인(Edit)'}
                  </th>
                ) : null}
                {showReturnCols ? (
                  <>
                    <th className="h-10 px-2 border-t border-slate-200">사용금액(원)</th>
                    <th className="h-10 px-2 border-t border-slate-200">회수일자</th>
                    <th className="h-10 px-2 border-t border-r border-slate-200">사용자확인</th>
                    {isMasterTable ? (
                      <th className="h-10 px-2 border-t border-r border-slate-200">
                        {isMasterHistory ? '관리담당자 확인' : '관리담당자 확인(Edit)'}
                      </th>
                    ) : null}
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-medium text-slate-700">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      isMasterHistory
                        ? 14
                        : isMasterTable
                          ? 14
                          : showReturnCols
                            ? 12
                            : 9
                    }
                    className="p-16 text-center text-slate-400 text-[11px] font-medium"
                  >
                    {isMasterHistory
                      ? '반납 완료 내역이 없습니다.'
                      : isMonitoring
                        ? '전사 사용 내역이 없습니다.'
                        : '진행 중인 사용 내역이 없습니다.'}
                  </td>
                </tr>
              ) : (
                paginatedItems.map((row, i) => {
                  const rowNo = filteredItems.length - ((currentPage - 1) * itemsPerPage + i);
                  const isEditing = editingId === row.id && !!draft;
                  const dateStatusClass =
                    row.status === 'RESERVED' ? 'text-red-700' : 'text-slate-700';
                  const canCancelReserve = isMasterTable
                    ? row.status === 'CHECKOUT_PENDING'
                    : row.status === 'RESERVED' || row.status === 'CHECKOUT_PENDING';
                  const canEditRow = row.status !== 'RETURNED' && row.status !== 'RETURNING';
                  const canConfirmManagerStatus =
                    isMonitoring && row.status === 'RETURNING' && !row.managerConfirmedBy;
                  const canConfirmCheckoutStatus =
                    isMonitoring && row.status === 'CHECKOUT_PENDING' && !row.checkoutConfirmedBy;
                  const canConfirmManager = canConfirmManagerStatus && canEdit;
                  const canConfirmCheckout = canConfirmCheckoutStatus && canEdit;
                  return (
                    <tr
                      key={row.id}
                      className={`h-14 min-h-14 transition-colors ${
                        isEditing
                          ? 'bg-sky-50/70'
                          : isMasterHistory && selectedHistoryIds.has(row.id)
                            ? 'bg-indigo-50/40'
                            : 'hover:bg-slate-50'
                      }`}
                    >
                      {isMasterHistory ? (
                        <td className="px-1 border-r border-slate-200">
                          <input
                            type="checkbox"
                            checked={selectedHistoryIds.has(row.id)}
                            onChange={() => toggleHistoryRow(row.id)}
                            className="w-3.5 h-3.5 accent-indigo-600 rounded cursor-pointer"
                            aria-label={`${rowNo}번 선택`}
                          />
                        </td>
                      ) : null}
                      <td
                        className={`tabular-nums px-1 overflow-hidden border-r border-slate-200 ${
                          isMasterHistory
                            ? 'font-mono text-slate-500'
                            : 'text-slate-400'
                        }`}
                      >
                        {rowNo}
                      </td>
                      <td className="px-2 border-r border-slate-200">
                        {isMasterTable ? (
                          <span
                            className="block leading-tight"
                            title={`${row.last4}${row.unitName ? ` · ${row.unitName}` : ''}`}
                          >
                            <span className="block tabular-nums text-[11px] font-medium">{row.last4 || '-'}</span>
                            <span className="block truncate text-[10px] font-medium text-slate-500">
                              {row.unitName || '-'}
                            </span>
                          </span>
                        ) : (
                          <span className="tabular-nums">{row.last4}</span>
                        )}
                      </td>
                      <td className="px-2">
                        <ApplicantName row={row} />
                      </td>
                      <td className="px-1">
                        {isEditing && !isMasterTable ? (
                          <input
                            type="text"
                            value={draft.place}
                            onChange={(e) => setDraft({ ...draft, place: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-md px-1.5 py-1 text-center text-[11px] font-medium outline-none focus:border-sky-500"
                            placeholder="사용처"
                          />
                        ) : (
                          <span className="truncate block" title={row.place}>
                            {row.place || '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-1">
                        {isEditing && !isMasterTable ? (
                          <input
                            type="text"
                            value={draft.purpose}
                            onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-md px-1.5 py-1 text-center text-[11px] font-medium outline-none focus:border-sky-500"
                            placeholder="사용목적"
                          />
                        ) : (
                          <span className="truncate block" title={row.purpose}>
                            {row.purpose || '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-1 overflow-visible">
                        {isEditing &&
                        row.status === 'RESERVED' &&
                        !row.checkoutAt ? (
                          <DateTime24Input
                            compact
                            combined
                            value={draft.receiveAt}
                            onChange={(next) => setDraft({ ...draft, receiveAt: next })}
                            className="w-full justify-center"
                          />
                        ) : (
                          <UsageDateTimeStack
                            value={row.checkoutAt || row.reservedAt}
                            className={dateStatusClass}
                          />
                        )}
                      </td>
                      <td className="px-1 overflow-visible border-r border-slate-200">
                        {isEditing && row.status !== 'CHECKED_OUT' ? (
                          <DateTime24Input
                            compact
                            combined
                            value={draft.expectedReturnAt}
                            onChange={(next) => setDraft({ ...draft, expectedReturnAt: next })}
                            className="w-full justify-center"
                          />
                        ) : (
                          <UsageDateTimeStack
                            value={row.expectedReturnAt}
                            className={dateStatusClass}
                          />
                        )}
                      </td>
                      {isMasterTable ? (
                      <td
                        className={`px-1 border-r border-slate-200 ${
                          canConfirmCheckout ? CONFIRM_CELL_CHECKOUT : ''
                        }`}
                      >
                        {isEditing ? (
                          <span>-</span>
                        ) : row.checkoutConfirmedBy ? (
                          <ManagerConfirmStamp
                            name={row.checkoutConfirmedBy}
                            at={row.checkoutConfirmedAt}
                          />
                        ) : canConfirmCheckoutStatus ? (
                          <button
                            type="button"
                            disabled={saving || !canEdit}
                            title={
                              canEdit
                                ? '반출 확인'
                                : '모니터링 Edit 권한이 필요합니다.'
                            }
                            onClick={() => {
                              if (!canEdit) {
                                return alert('모니터링 편집 권한이 없습니다.');
                              }
                              handleConfirmCheckout(row);
                            }}
                            className={
                              canEdit
                                ? CONFIRM_BTN_CHECKOUT
                                : `${CONFIRM_BTN_CHECKOUT} opacity-50 cursor-not-allowed hover:bg-amber-400 hover:border-amber-500`
                            }
                          >
                            반출 확인
                          </button>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      ) : null}
                      {showReturnCols ? (
                        <>
                          <td className="px-1">
                            <span>
                              {isEditing ? '-' : row.amount ? formatAmount(row.amount) : '-'}
                            </span>
                          </td>
                          <td className="px-1">
                            {isEditing ? (
                              <span>-</span>
                            ) : (
                              <UsageDateTimeStack value={row.returnedAt} />
                            )}
                          </td>
                          <td className="px-1 border-r border-slate-200">
                            {isEditing ? (
                              <span>-</span>
                            ) : (
                              <ConfirmedByName name={row.userConfirmedBy} returnType={row.returnType} />
                            )}
                          </td>
                          {isMasterTable ? (
                          <td
                            className={`px-1 border-r border-slate-200 ${
                              canConfirmManager ? CONFIRM_CELL_RETURN : ''
                            }`}
                          >
                            {isEditing ? (
                              <span>-</span>
                            ) : row.managerConfirmedBy ? (
                              <ManagerConfirmStamp
                                name={row.managerConfirmedBy}
                                at={row.managerConfirmedAt}
                              />
                            ) : canConfirmManagerStatus ? (
                              <button
                                type="button"
                                disabled={saving || !canEdit}
                                title={
                                  canEdit
                                    ? '반납 확인'
                                    : '모니터링 Edit 권한이 필요합니다.'
                                }
                                onClick={() => {
                                  if (!canEdit) {
                                    return alert('모니터링 편집 권한이 없습니다.');
                                  }
                                  handleConfirmManager(row);
                                }}
                                className={
                                  canEdit
                                    ? CONFIRM_BTN_RETURN
                                    : `${CONFIRM_BTN_RETURN} opacity-50 cursor-not-allowed hover:bg-emerald-200 hover:border-emerald-400`
                                }
                              >
                                반납 확인
                              </button>
                            ) : (
                              <span>-</span>
                            )}
                          </td>
                          ) : null}
                        </>
                      ) : null}
                      <td
                        className={`px-1 ${isMasterHistory ? '' : 'border-r border-slate-200'}`}
                      >
                        <span className={rowStatusClass(row.status)}>{rowStatusLabel(row.status)}</span>
                      </td>
                      {!isMasterHistory ? (
                        <td className="px-1">
                          {isMasterTable ? (
                            canCancelReserve ? (
                              <button
                                type="button"
                                data-action-kebab
                                disabled={saving}
                                title="더보기"
                                onClick={(e) => {
                                  const rect = (
                                    e.currentTarget as HTMLButtonElement
                                  ).getBoundingClientRect();
                                  setActionKebab({
                                    id: row.id,
                                    top: rect.bottom + 4,
                                    left: Math.max(8, rect.right - 132),
                                  });
                                }}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                                  actionKebab?.id === row.id
                                    ? 'bg-slate-200 text-slate-800'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                }`}
                              >
                                <svg
                                  viewBox="0 0 20 20"
                                  className="w-4 h-4"
                                  fill="currentColor"
                                  aria-hidden
                                >
                                  <circle cx="10" cy="4.5" r="1.6" />
                                  <circle cx="10" cy="10" r="1.6" />
                                  <circle cx="10" cy="15.5" r="1.6" />
                                </svg>
                              </button>
                            ) : null
                          ) : (
                            <div className="flex gap-1 justify-center flex-wrap">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => handleSaveEdit(row)}
                                    className="text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-sky-600 text-white border-sky-600"
                                  >
                                    저장
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(null);
                                      setDraft(null);
                                    }}
                                    className={ACTION_BTN}
                                  >
                                    취소
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={saving || !canEditRow}
                                    onClick={() => startEdit(row)}
                                    className={canEditRow ? ACTION_BTN : DISABLED_BTN}
                                  >
                                    수정
                                  </button>
                                  {canCancelReserve ? (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() => handleCancelReserve(row)}
                                      className="text-[11px] font-medium px-2 py-1 rounded-md border whitespace-nowrap bg-white text-rose-500 border-rose-200 hover:border-rose-400"
                                    >
                                      {row.status === 'CHECKOUT_PENDING'
                                        ? '수령신청취소'
                                        : '예약취소'}
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filteredItems.length > 0 ? (
          <WindowedPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        ) : null}
      </div>
      {isMasterTable && actionKebab
        ? createPortal(
            <div
              ref={actionKebabRef}
              style={{ top: actionKebab.top, left: actionKebab.left }}
              className="fixed z-[500] w-[132px] rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-left"
            >
              <button
                type="button"
                disabled={saving}
                className="w-full px-3 py-2 text-left text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                onClick={() => {
                  const row = items.find((r) => r.id === actionKebab.id);
                  setActionKebab(null);
                  if (!row) return;
                  void handleCancelReserve(row);
                }}
              >
                반출취소
              </button>
            </div>,
            document.body
          )
        : null}
      </>
      ) : null}

      {checkoutConfirmRow ? (
        <div className="fixed inset-0 z-[55] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-lg border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 bg-sky-600 text-white text-sm font-medium">
              반출 확인 · {checkoutConfirmRow.cardName}
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] font-medium text-slate-500">
                카드번호 {checkoutConfirmRow.last4}
              </p>
              <dl className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <dt className="w-[72px] shrink-0 text-[11px] font-medium text-slate-500">
                    수령신청자
                  </dt>
                  <dd className="text-sm font-medium text-slate-900">
                    {String(checkoutConfirmRow.userName || '').trim() || '-'}
                  </dd>
                </div>
                <div className="flex items-start gap-2">
                  <dt className="w-[72px] shrink-0 text-[11px] font-medium text-slate-500">
                    수령자지정
                  </dt>
                  <dd className="text-sm font-medium text-slate-900">
                    {pickupDesignationLabel(checkoutConfirmRow)}
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                실물 카드 반출을 확인할까요? 확인 후 카드가 대여중 상태가 됩니다.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCheckoutConfirmRow(null)}
                  className="h-8 px-3 rounded-md text-[11px] font-medium border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitConfirmCheckout()}
                  className={`h-8 px-3 rounded-md text-[11px] font-medium ${
                    saving
                      ? 'bg-slate-300 text-white cursor-not-allowed'
                      : 'bg-sky-600 text-white hover:bg-sky-700'
                  }`}
                >
                  반출 확인
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {returnConfirmRow ? (
        <div className="fixed inset-0 z-[55] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-lg border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 bg-sky-600 text-white text-sm font-medium">
              반납 확인 · {returnConfirmRow.cardName}
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] font-medium text-slate-500">
                카드번호 {returnConfirmRow.last4}
              </p>
              <dl className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2">
                  <dt className="w-[72px] shrink-0 text-[11px] font-medium text-slate-500">
                    수령자
                  </dt>
                  <dd className="text-sm font-medium text-slate-900">
                    {pickupDesignationLabel(returnConfirmRow)}
                  </dd>
                </div>
                <div className="flex items-start gap-2">
                  <dt className="w-[72px] shrink-0 text-[11px] font-medium text-slate-500">
                    반납자
                  </dt>
                  <dd className="text-sm font-medium text-slate-900">
                    {returnDesignationLabel(returnConfirmRow)}
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                실물 카드 반납을 확인할까요? 확인 후 카드가 신청가능 상태가 됩니다.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReturnConfirmRow(null)}
                  className="h-8 px-3 rounded-md text-[11px] font-medium border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitConfirmManager()}
                  className={`h-8 px-3 rounded-md text-[11px] font-medium ${
                    saving
                      ? 'bg-slate-300 text-white cursor-not-allowed'
                      : 'bg-sky-600 text-white hover:bg-sky-700'
                  }`}
                >
                  반납 확인
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {checkoutReserveNotice ? (
        <div className="fixed inset-0 z-[55] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-lg border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 bg-sky-600 text-white text-sm font-medium">
              예약이력 확인 · {checkoutReserveNotice.card.name}
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm font-medium text-slate-800">예약이력이 있습니다.</p>
              <p className="text-[11px] font-medium text-slate-500">
                카드번호 {checkoutReserveNotice.card.last4}
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left">
                <span className={rowStatusClass(checkoutReserveNotice.reservation.status)}>
                  {rowStatusLabel(checkoutReserveNotice.reservation.status)}
                </span>
                <p className="text-xs font-medium text-slate-800 mt-1.5">
                  {occupancyHolderName(checkoutReserveNotice.reservation) ||
                    checkoutReserveNotice.reservation.userName ||
                    '-'}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {formatUsageDateTime(
                    checkoutReserveNotice.reservation.checkoutAt ||
                      checkoutReserveNotice.reservation.reservedAt
                  )}
                  {' ~ '}
                  {formatUsageDateTime(checkoutReserveNotice.reservation.expectedReturnAt)}
                </p>
                {checkoutReserveNotice.reservation.place ? (
                  <p className="text-[11px] text-slate-600 mt-1">
                    사용처 {checkoutReserveNotice.reservation.place}
                  </p>
                ) : null}
                {checkoutReserveNotice.reservation.purpose ? (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    사용목적 {checkoutReserveNotice.reservation.purpose}
                  </p>
                ) : null}
              </div>
              <p className="text-[11px] font-medium text-slate-500">
                이 예약을 이어 수령하려면 아래에서 수령하기를 눌러 주세요.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCheckoutReserveNotice(null)}
                  className="h-8 px-3 rounded-md text-[11px] font-medium border border-slate-200 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() =>
                    beginCheckoutForm(
                      checkoutReserveNotice.card,
                      checkoutReserveNotice.reservation
                    )
                  }
                  className="h-8 px-3 rounded-md text-[11px] font-medium bg-sky-600 text-white hover:bg-sky-700"
                >
                  수령하기
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {scheduleCard ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-lg border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 bg-sky-600 text-white text-sm font-medium">
              예약·대여 현황 · {scheduleCard.name}
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[11px] font-medium text-slate-500">
                카드번호 {scheduleCard.last4}
              </p>
              {items.filter((row) => row.cardId === scheduleCard.id).length === 0 ? (
                <p className="text-xs font-medium text-slate-400 py-6 text-center">
                  현재 예약·대여 중인 내역이 없습니다.
                </p>
              ) : (
                <ul className="space-y-2">
                  {items
                    .filter((row) => row.cardId === scheduleCard.id)
                    .map((row) => (
                      <li
                        key={row.id}
                        className="rounded-lg border border-slate-200 px-3 py-2.5 text-left"
                      >
                        <span className={rowStatusClass(row.status)}>{rowStatusLabel(row.status)}</span>
                        <p className="text-xs font-medium text-slate-800 mt-1.5">
                          {occupancyHolderName(row) || '-'}
                        </p>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          {formatUsageDateTime(row.checkoutAt || row.reservedAt)}
                          {' ~ '}
                          {formatUsageDateTime(row.expectedReturnAt)}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setScheduleCard(null)}
                  className="h-8 px-3 rounded-md text-[11px] font-medium border border-slate-200 bg-white text-slate-600"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {actionModal ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-lg border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-5 py-3 bg-sky-600 text-white text-sm font-medium">
              {actionModal.kind === 'RESERVE'
                ? '예약'
                : actionModal.kind === 'CHECKOUT'
                  ? '수령'
                  : '반납'}{' '}
              · {actionModal.card.name}
            </div>
            <div className="p-5 space-y-3">
              {actionModal.kind === 'RESERVE' ? (
                <div className="bg-amber-50 border border-amber-700 rounded-lg px-3 py-2.5">
                  <p className="text-[11px] font-medium text-amber-900 leading-relaxed">
                    💡 본 예약은 부서원 간 중복 방지를 위한 사전 일정 확보용입니다. (부서 내만 일정 공유)
                  </p>
                </div>
              ) : null}
              {actionModal.kind === 'CHECKOUT' ? (
                <div className="bg-amber-50 border border-amber-700 rounded-lg px-3 py-2">
                  <GroupwareShortcut
                    url={groupwareUrl}
                    showSettings={false}
                    className="w-full justify-between"
                  />
                </div>
              ) : null}
              <p className="text-[11px] font-medium text-slate-500">
                카드번호 {actionModal.card.last4}
              </p>
              {actionModal.kind === 'RESERVE' ? (
                <>
                  <p className="text-xs font-medium text-slate-600">
                    수령 예정{' '}
                    <span className="text-red-700 font-medium">
                      {checkoutPlanAt.replace('T', ' ')}
                    </span>
                    {' ~ '}
                    반납 예정{' '}
                    <span className="text-red-700 font-medium">
                      {returnPlanAt.replace('T', ' ')}
                    </span>
                  </p>
                  <div>
                    <label className="text-sm font-medium text-slate-900 block mb-1">사용처</label>
                    <input
                      type="text"
                      value={actionPlace}
                      onChange={(e) => setActionPlace(e.target.value)}
                      placeholder="사용처를 입력하세요"
                      className="w-full h-10 bg-white border border-slate-200 rounded-lg px-3 text-sm font-medium text-slate-900 outline-none focus:border-sky-500 placeholder:text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-900 block mb-1">사용목적</label>
                    <input
                      type="text"
                      value={actionPurpose}
                      onChange={(e) => setActionPurpose(e.target.value)}
                      placeholder="사용목적을 입력하세요"
                      className="w-full h-10 bg-white border border-slate-200 rounded-lg px-3 text-sm font-medium text-slate-900 outline-none focus:border-sky-500 placeholder:text-slate-400"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium text-slate-900 block mb-1">
                      {actionModal.kind === 'CHECKOUT' ? (
                        <>
                          수령 일시<span className="ml-0.5 text-rose-500">*</span>
                        </>
                      ) : (
                        <>
                          반납 일시<span className="ml-0.5 text-rose-500">*</span>
                        </>
                      )}
                    </label>
                    <DateTime24Input
                      tone={actionModal.kind === 'CHECKOUT' ? 'sky' : 'white'}
                      value={actionAt}
                      onChange={(next) => {
                        setActionAt(next);
                        if (
                          actionModal.kind === 'CHECKOUT' &&
                          (returnOffsetDays !== '' || returnOffsetHours !== '')
                        ) {
                          applyReturnQuick(returnOffsetDays, returnOffsetHours, next);
                        }
                      }}
                    />
                  </div>
                  {actionModal.kind === 'CHECKOUT' ? (
                    <div>
                      <label className="text-sm font-medium text-slate-900 block mb-1">
                        반납예정일<span className="ml-0.5 text-rose-500">*</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <DateTime24Input
                          tone="sky"
                          value={actionReturnAt}
                          onChange={setActionReturnAt}
                        />
                        <QuickOffsetRow
                          days={returnOffsetDays}
                          hours={returnOffsetHours}
                          onChange={(days, hours) => {
                            setReturnOffsetDays(days);
                            setReturnOffsetHours(hours);
                            if (days === '' && hours === '') return;
                            applyReturnQuick(days, hours);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {actionModal.kind === 'CHECKOUT' || actionModal.kind === 'RETURN' ? (
                    <>
                      <div>
                        <label className="text-sm font-medium text-slate-900 block mb-1">
                          사용처<span className="ml-0.5 text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={actionPlace}
                          onChange={(e) => setActionPlace(e.target.value)}
                          placeholder="사용처를 입력하세요"
                          className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-500 placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-900 block mb-1">
                          사용목적<span className="ml-0.5 text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={actionPurpose}
                          onChange={(e) => setActionPurpose(e.target.value)}
                          placeholder="사용목적을 입력하세요"
                          className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-500 placeholder:text-slate-400"
                        />
                      </div>
                    </>
                  ) : null}
                  {actionModal.kind === 'RETURN' ? (
                    <div>
                      <label className="text-sm font-medium text-slate-900 block mb-1">
                        사용금액(원)<span className="ml-0.5 text-rose-500">*</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={actionAmount}
                          onChange={(e) => setActionAmount(formatAmount(e.target.value))}
                          inputMode="numeric"
                          placeholder="예: 125,000"
                          className="flex-1 min-w-0 h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-500"
                        />
                        <span className="text-sm font-medium text-slate-900 shrink-0">원</span>
                      </div>
                    </div>
                  ) : null}
                  {actionModal.kind === 'CHECKOUT' ? (
                    <div>
                      <label className="text-sm font-medium text-slate-900 flex items-baseline gap-2 mb-1">
                        <span>
                          수령자 정보<span className="ml-0.5 text-rose-500">*</span>
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">
                          지정된 수령자만 카드 수령 가능
                        </span>
                      </label>
                      <div className="flex items-center gap-6">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="pickupMode"
                            value="SELF"
                            checked={pickupMode === 'SELF'}
                            onChange={() => {
                              setPickupMode('SELF');
                              setPickupMemberId('');
                            }}
                            className="h-3.5 w-3.5 accent-sky-600"
                          />
                          <span className="text-sm font-medium text-slate-800">기안자 본인</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="pickupMode"
                            value="PROXY"
                            checked={pickupMode === 'PROXY'}
                            onChange={() => {
                              setPickupMode('PROXY');
                              if (deptMembers.length === 0 && !membersLoading) {
                                void loadDeptMembers();
                              }
                            }}
                            className="h-3.5 w-3.5 accent-sky-600"
                          />
                          <span className="text-sm font-medium text-slate-800">부서원 지정</span>
                        </label>
                      </div>
                      <div
                        className={`overflow-hidden transition-all duration-200 ease-out ${
                          pickupMode === 'PROXY'
                            ? 'mt-2 max-h-24 opacity-100'
                            : 'mt-0 max-h-0 opacity-0'
                        }`}
                      >
                        <select
                          value={pickupMemberId}
                          onChange={(e) => setPickupMemberId(e.target.value)}
                          disabled={membersLoading}
                          className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <option value="">
                            {membersLoading ? '부서원 불러오는 중…' : '대리 수령자를 선택하세요'}
                          </option>
                          {deptMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}
                  {actionModal.kind === 'RETURN' ? (
                    <div>
                      <label className="text-sm font-medium text-slate-900 flex items-baseline gap-2 mb-1">
                        <span>
                          반납자 정보<span className="ml-0.5 text-rose-500">*</span>
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">
                          지정된 반납자만 카드 반납 가능
                        </span>
                      </label>
                      <div className="flex items-center gap-6">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="returnMode"
                            value="SELF"
                            checked={returnMode === 'SELF'}
                            onChange={() => {
                              setReturnMode('SELF');
                              setReturnMemberId('');
                            }}
                            className="h-3.5 w-3.5 accent-sky-600"
                          />
                          <span className="text-sm font-medium text-slate-800">수령자</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="returnMode"
                            value="PROXY"
                            checked={returnMode === 'PROXY'}
                            onChange={() => {
                              setReturnMode('PROXY');
                              if (deptMembers.length === 0 && !membersLoading) {
                                void loadDeptMembers();
                              }
                            }}
                            className="h-3.5 w-3.5 accent-sky-600"
                          />
                          <span className="text-sm font-medium text-slate-800">부서원 지정</span>
                        </label>
                      </div>
                      <div
                        className={`overflow-hidden transition-all duration-200 ease-out ${
                          returnMode === 'PROXY'
                            ? 'mt-2 max-h-24 opacity-100'
                            : 'mt-0 max-h-0 opacity-0'
                        }`}
                      >
                        <select
                          value={returnMemberId}
                          onChange={(e) => setReturnMemberId(e.target.value)}
                          disabled={membersLoading}
                          className="w-full h-9 bg-white border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-900 outline-none focus:border-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <option value="">
                            {membersLoading ? '부서원 불러오는 중…' : '대리 반납자를 선택하세요'}
                          </option>
                          {deptMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
              {actionModal.kind === 'CHECKOUT' ? (
                <p className="text-[11px] font-medium text-sky-600 text-right leading-relaxed">
                  ℹ️ <span className="text-slate-900">수령 신청 후</span> [수령 대기중 상태],
                  <br />
                  경영기획센터에 방문하여{' '}
                  <span className="text-slate-900">실물 카드를 수령해 주세요.</span>
                </p>
              ) : actionModal.kind === 'RETURN' ? (
                <p className="text-[11px] font-medium text-sky-600 text-right leading-relaxed">
                  ℹ️ <span className="text-slate-900">반납 처리 후</span> [반납 대기중 상태],
                  <br />
                  경영기획센터에 방문하여{' '}
                  <span className="text-slate-900">실물 카드를 반납해 주세요.</span>
                </p>
              ) : null}
              {showTimeOrderWarning ? (
                <p className="text-[11px] font-medium text-rose-600 text-right">
                  {TIME_ORDER_WARNING}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="h-8 px-3 rounded-md text-[11px] font-medium border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                >
                  취소
                </button>
                {actionModal.kind === 'CHECKOUT' ? (
                  <button
                    type="button"
                    disabled={saving || checkoutSubmitDisabled}
                    onClick={() => void submitCheckout()}
                    className={`h-8 px-3 rounded-md text-[11px] font-medium ${
                      saving || checkoutSubmitDisabled
                        ? 'bg-slate-300 text-white cursor-not-allowed'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    수령 신청
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving || actionSubmitDisabled}
                    onClick={submitModal}
                    className={`h-8 px-3 rounded-md text-[11px] font-medium ${
                      saving || actionSubmitDisabled
                        ? 'bg-slate-300 text-white cursor-not-allowed'
                        : 'bg-sky-600 text-white hover:bg-sky-700'
                    }`}
                  >
                    {actionModal.kind === 'RESERVE' ? '예약 등록' : '반납 처리'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {groupwareEditor != null ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-medium text-slate-900">그룹웨어 바로가기 경로 설정</h3>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">
              개인별로 그룹웨어 경로를 설정하세요. 본인 계정에만 저장됩니다.
              <br />
              <span className="text-sky-600">
                그룹웨어 전자결재 &gt; 법인카드 사용신청서
              </span>
            </p>
            <input
              type="text"
              value={groupwareEditor}
              onChange={(e) => setGroupwareEditor(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-sky-500"
              placeholder={DEFAULT_CORP_CARD_GROUPWARE_URL}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGroupwareEditor(null)}
                className="rounded-md bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveGroupware}
                className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DeptBoardModule() {
  return (
    <CorpCardScaffold
      titleEn="CORPORATE CARD · DEPT BOARD"
      title="부서 법인카드 보드"
      description="부서 카드의 예약·대여 현황을 보고 신청합니다. 진행 중 내역만 카드 아래에서 확인하며, 반납 대기부터는 마스터 모니터링에서 관리합니다."
      tabs={CORP_CARD_DEPT_TABS}
      tabPrefix="/asset/corp-card/dept"
      bannerLead="dept"
    >
      <BoardPanel variant="board" />
    </CorpCardScaffold>
  );
}
