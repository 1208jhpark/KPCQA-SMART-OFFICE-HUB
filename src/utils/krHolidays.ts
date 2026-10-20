/**
 * 대한민국 관공서 공휴일 (대체·임시 포함)
 * 고정 양력 + 연도별 음력(설·추석·부처님오신날)·대체공휴일 테이블
 */

export type KrHoliday = { date: string; name: string };

/** 연도별 가변 공휴일 (설·추석·부처님오신날·대체·임시·선거 등) */
const VARIABLE_BY_YEAR: Record<number, KrHoliday[]> = {
  2025: [
    { date: '2025-01-27', name: '임시공휴일' },
    { date: '2025-01-28', name: '설날 연휴' },
    { date: '2025-01-29', name: '설날' },
    { date: '2025-01-30', name: '설날 연휴' },
    { date: '2025-03-03', name: '대체공휴일(삼일절)' },
    { date: '2025-05-05', name: '어린이날·부처님오신날' },
    { date: '2025-05-06', name: '대체공휴일' },
    { date: '2025-06-03', name: '대통령 선거일' },
    { date: '2025-10-05', name: '추석 연휴' },
    { date: '2025-10-06', name: '추석' },
    { date: '2025-10-07', name: '추석 연휴' },
    { date: '2025-10-08', name: '대체공휴일(추석)' },
  ],
  2026: [
    { date: '2026-02-16', name: '설날 연휴' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 연휴' },
    { date: '2026-03-02', name: '대체공휴일(삼일절)' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-05-25', name: '대체공휴일(부처님오신날)' },
    { date: '2026-06-03', name: '지방선거일' },
    { date: '2026-08-17', name: '대체공휴일(광복절)' },
    { date: '2026-09-24', name: '추석 연휴' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 연휴' },
    { date: '2026-10-05', name: '대체공휴일(개천절)' },
  ],
  2027: [
    { date: '2027-02-06', name: '설날 연휴' },
    { date: '2027-02-07', name: '설날' },
    { date: '2027-02-08', name: '설날 연휴' },
    { date: '2027-02-09', name: '대체공휴일(설날)' },
    { date: '2027-05-03', name: '대체공휴일(노동절)' },
    { date: '2027-05-13', name: '부처님오신날' },
    { date: '2027-07-19', name: '대체공휴일(제헌절)' },
    { date: '2027-08-16', name: '대체공휴일(광복절)' },
    { date: '2027-09-14', name: '추석 연휴' },
    { date: '2027-09-15', name: '추석' },
    { date: '2027-09-16', name: '추석 연휴' },
    { date: '2027-10-04', name: '대체공휴일(개천절)' },
    { date: '2027-10-11', name: '대체공휴일(한글날)' },
    { date: '2027-12-27', name: '대체공휴일(성탄절)' },
  ],
};

/** 매년 동일 양력 공휴일 */
function fixedSolarHolidays(year: number): KrHoliday[] {
  const list: KrHoliday[] = [
    { date: `${year}-01-01`, name: '신정' },
    { date: `${year}-03-01`, name: '삼일절' },
    { date: `${year}-05-01`, name: '근로자의 날' },
    { date: `${year}-05-05`, name: '어린이날' },
    { date: `${year}-06-06`, name: '현충일' },
    { date: `${year}-07-17`, name: '제헌절' },
    { date: `${year}-08-15`, name: '광복절' },
    { date: `${year}-10-03`, name: '개천절' },
    { date: `${year}-10-09`, name: '한글날' },
    { date: `${year}-12-25`, name: '성탄절' },
  ];
  return list;
}

/** 해당 연도 공휴일 Map (date → name). 동일 날짜는 가변 명칭 우선 */
export function getKrHolidaysForYear(year: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of fixedSolarHolidays(year)) {
    map.set(h.date, h.name);
  }
  for (const h of VARIABLE_BY_YEAR[year] || []) {
    map.set(h.date, h.name);
  }
  return map;
}

export function getKrHolidayName(dateStr: string): string | null {
  const y = Number(String(dateStr || '').slice(0, 4));
  if (!y) return null;
  return getKrHolidaysForYear(y).get(dateStr) || null;
}

/** 공휴일 바 — 연한 빨강 (구글캘린더식) */
export const KR_HOLIDAY_COLOR = '#e57373';
