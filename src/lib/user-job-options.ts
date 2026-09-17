/** /admin/users 전용 직책·직급 옵션 (master-data 비의존) */

export type UserJobOption = {
  label: string; // 한글
  value: string; // 영문
};

/** 배열 순서 = 직책 랭킹 (앞일수록 상위) */
export const DEFAULT_USER_DUTY_OPTIONS: UserJobOption[] = [
  { label: '원장', value: 'CEO' },
  { label: '부원장', value: 'Vice President' },
  { label: '상무', value: 'Executive Director' },
  { label: '본부장', value: 'Director' },
  { label: '센터장', value: 'Manager' },
  { label: '팀원', value: '' },
];

/** 배열 순서 = 직급 랭킹 (앞일수록 상위) */
export const DEFAULT_USER_GRADE_OPTIONS: UserJobOption[] = [
  { label: '원장', value: 'CEO' },
  { label: '부원장', value: 'Vice President' },
  { label: '수석전문위원', value: 'Chief Expert Advisor' },
  { label: '책임전문위원', value: 'Chief Technical Expert' },
  { label: '선임전문위원', value: 'Senior Technical Expert' },
  { label: '전문위원', value: 'Technical Expert' },
  { label: '연구원', value: 'Researcher' },
  { label: '전문원', value: 'Specialist' },
  { label: '인턴', value: 'Intern' },
];

export function normalizeUserJobOptions(raw: unknown): UserJobOption[] {
  if (!Array.isArray(raw)) return [];
  const out: UserJobOption[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const label = String((row as any).label ?? '').trim();
    const value = String((row as any).value ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value });
  }
  return out;
}

export function resolveUserDutyOptions(raw?: unknown): UserJobOption[] {
  const list = normalizeUserJobOptions(raw);
  return list.length > 0 ? list : [...DEFAULT_USER_DUTY_OPTIONS];
}

export function resolveUserGradeOptions(raw?: unknown): UserJobOption[] {
  const list = normalizeUserJobOptions(raw);
  return list.length > 0 ? list : [...DEFAULT_USER_GRADE_OPTIONS];
}

function rankByLabel(options: UserJobOption[], label: string | null | undefined): number {
  const key = String(label ?? '').trim();
  if (!key) return 10_000;
  const idx = options.findIndex((o) => o.label === key);
  return idx >= 0 ? idx : 9_000;
}

/**
 * /admin/users 목록 정렬:
 * 1) 직책 옵션 순서 (앞일수록 상위 · 미지정은 맨 뒤)
 * 2) 같은 직책 안 직급 옵션 순서
 * 3) 이름
 */
export function compareUsersByDutyGrade(
  a: { name?: string | null; duty?: string | null; grade?: string | null },
  b: { name?: string | null; duty?: string | null; grade?: string | null },
  duties: UserJobOption[],
  grades: UserJobOption[]
): number {
  const dutyDiff = rankByLabel(duties, a.duty) - rankByLabel(duties, b.duty);
  if (dutyDiff !== 0) return dutyDiff;

  const gradeDiff = rankByLabel(grades, a.grade) - rankByLabel(grades, b.grade);
  if (gradeDiff !== 0) return gradeDiff;

  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko');
}
