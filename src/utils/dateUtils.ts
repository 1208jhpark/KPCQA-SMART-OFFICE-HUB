// src/utils/dateUtils.ts

const KST = 'Asia/Seoul';

/**
 * 한국 시간(KST, Asia/Seoul) 기준 YYYY-MM-DD.
 * 브라우저/서버 로컬 TZ와 무관하게 항상 한국 날짜를 반환합니다.
 */
export const getKSTDateString = (dateInput: Date | string | number = Date.now()) => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

/** KST 기준 연·월 (month: 1–12). 파싱 실패 시 null */
export const getKSTYearMonth = (dateInput: Date | string | number) => {
  const ymd = getKSTDateString(dateInput);
  if (!ymd) return null;
  const [year, month] = ymd.split('-').map(Number);
  if (!year || !month) return null;
  return { year, month };
};

/** 지금 시각의 KST 연·월 */
export const getKSTNowYearMonth = () => {
  return getKSTYearMonth(Date.now()) ?? { year: 1970, month: 1 };
};

/**
 * 지급 업무일: dist_date(지급일자) 우선, 없으면 createdAt(신청일).
 * Dashboard / Dept / ClientSearch 집계 공통.
 */
export function getDistBusinessDate(d: {
  dist_date?: string | Date | null;
  createdAt?: string | Date | null;
}): string | Date | null {
  return d?.dist_date || d?.createdAt || null;
}

/**
 * KST 기준 특정 연도의 절대 시각 범위 [start, end) — DB 쿼리 필터용.
 * 예: 2026 → 2025-12-31T15:00Z 이상 ~ 2026-12-31T15:00Z 미만
 */
export const getKSTYearRange = (year: number) => ({
  start: new Date(`${year}-01-01T00:00:00+09:00`),
  end: new Date(`${year + 1}-01-01T00:00:00+09:00`),
});

/**
 * date input(YYYY-MM-DD)을 KST 정오(+09:00) Date로 파싱.
 * `new Date('YYYY-MM-DD')` UTC 자정 파싱으로 하루가 밀리는 문제를 막습니다.
 */
export const parseKSTDateOnly = (dateStr: string | null | undefined) => {
  if (!dateStr || typeof dateStr !== 'string') return new Date(NaN);
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(NaN);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
};

/**
 * 한국 시간 기준 HH:mm:ss
 */
export const getKSTTimeString = (dateInput: Date | string | number = Date.now()) => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
};

/**
 * 제출일시 등 표시용: `YYYY-MM-DD HH:mm:ss` (KST)
 */
export const formatKSTDateTime = (dateInput: Date | string | number | null | undefined) => {
  if (dateInput === null || dateInput === undefined || dateInput === '') return '-';
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '-';
  const d = getKSTDateString(date);
  const t = getKSTTimeString(date);
  return d && t ? `${d} ${t}` : '-';
};

/**
 * 설문 endDate(YYYY-MM-DD) + endTime(HH:mm)을 KST(+09:00) 절대 시각으로 파싱
 */
export const parseKSTDeadline = (endDate: string, endTime?: string | null) => {
  if (!endDate || typeof endDate !== 'string' || !endDate.includes('-')) {
    return new Date(NaN);
  }
  let time = (endTime || '23:59').trim() || '23:59';
  if (/^\d{2}:\d{2}$/.test(time)) time = `${time}:00`;
  return new Date(`${endDate.trim()}T${time}+09:00`);
};

/** 현재 시각이 KST 마감 시각을 지났는지 */
export const isPastKSTDeadline = (endDate: string, endTime?: string | null) => {
  const deadline = parseKSTDeadline(endDate, endTime);
  if (Number.isNaN(deadline.getTime())) return true;
  return Date.now() > deadline.getTime();
};

/**
 * KST 달력일 기준 D-day (종료일 - 오늘). 당일=0, 내일=1, 지남=음수
 */
export const getKSTDaysUntil = (endDate: string) => {
  const today = getKSTDateString();
  if (!endDate || !today) return 0;
  const end = new Date(`${endDate.trim()}T12:00:00+09:00`);
  const start = new Date(`${today}T12:00:00+09:00`);
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return 0;
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

/**
 * YYYY-MM-DD(또는 앞 10자)에 개월을 더한 KST 달력일.
 * `new Date('YYYY-MM-DD')` UTC 파싱 + setMonth 로컬 TZ 문제를 피합니다.
 */
export const addMonthsToKSTDateOnly = (
  dateStr: string | null | undefined,
  months: number
): string => {
  const m = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const add = Number(months) || 0;
  let year = Number(m[1]);
  let monthIndex = Number(m[2]) - 1 + add; // 0–11 기준
  const day = Number(m[3]);
  year += Math.floor(monthIndex / 12);
  monthIndex = ((monthIndex % 12) + 12) % 12;
  // 말일 클램프 (1/31 + 1개월 → 2/28|29)
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
};

/**
 * YYYY-MM-DD 달력 문자열을 KST 기준으로 `YYYY년 MM월 DD일 (요일)` 표기
 * (UTC midnight 파싱으로 하루 밀리는 문제 방지)
 */
export const formatKSTCalendarLabel = (dateStr: string, emptyFallback = '') => {
  if (!dateStr) return emptyFallback;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const dateObj = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  if (Number.isNaN(dateObj.getTime())) return dateStr;
  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, weekday: 'long' }).format(dateObj);
  return `${m[1]}년 ${m[2]}월 ${m[3]}일 (${weekday})`;
};

/**
 * Excel 시리얼(일 단위) → YYYY-MM-DD.
 * UTC 자정 변환 후 로컬/KST로 다시 읽으면 경계에서 하루가 밀릴 수 있어,
 * 1970-01-01(=25569) 기준 달력일을 UTC 정오 앵커로 고정한다.
 */
export function excelSerialToKSTDateString(serial: number): string {
  if (!Number.isFinite(serial)) return '';
  const days = Math.floor(serial + 1e-9);
  const utcNoon = Date.UTC(1970, 0, 1, 12, 0, 0) + (days - 25569) * 86400000;
  const d = new Date(utcNoon);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 엑셀 셀(시리얼 / Date / 문자열) → KST 업무일 YYYY-MM-DD
 */
export function parseExcelCellToKSTDateString(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    // SheetJS cellDates: Date 객체 — 달력일은 KST로 고정
    return getKSTDateString(val);
  }
  if (typeof val === 'number') return excelSerialToKSTDateString(val);

  let strVal = String(val).trim().replace(/[./]/g, '-');
  if (/^\d{8}$/.test(strVal)) {
    return `${strVal.slice(0, 4)}-${strVal.slice(4, 6)}-${strVal.slice(6, 8)}`;
  }
  const ymd = strVal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  // 이미 Date 파싱 가능한 문자열이면 KST 일자로
  const parsed = new Date(strVal);
  if (!Number.isNaN(parsed.getTime())) return getKSTDateString(parsed);
  return strVal;
}

/**
 * 정렬용 epoch(ms).
 * - 순수 YYYY-MM-DD: KST 정오로 해석 (UTC midnight 하루 밀림 방지)
 * - ISO datetime 등: 시각까지 유지 (같은 날 스레드 연계/랭크가 깨지지 않게)
 */
export function toSortableTime(input: Date | string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? 0 : input.getTime();
  const raw = String(input).trim();
  // date-only only — `2026-08-13T12:00:00.000Z` 는 아래 Date 파싱으로 보낸다
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = parseKSTDateOnly(raw).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

