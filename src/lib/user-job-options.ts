/** /admin/users 전용 직책·직급 옵션 (master-data 비의존) */

export type UserJobOption = {
  /** 식별 코드 (직책 DUTY_* / 직급 GRADE_*). 한글 변경 시 사용자 동기화 키 */
  code?: string;
  label: string; // 한글
  value: string; // 영문
};

/** 레거시 한글 라벨 → 직책 코드 (옵션에 code 없을 때 보정) */
export const LEGACY_DUTY_LABEL_TO_CODE: Record<string, string> = {
  원장: 'DUTY_CEO',
  부원장: 'DUTY_VP',
  상무: 'DUTY_EXEC',
  본부장: 'DUTY_HQ',
  센터장: 'DUTY_CENTER',
  팀원: 'DUTY_MEMBER',
};

/** 레거시 한글 라벨 → 직급 코드 */
export const LEGACY_GRADE_LABEL_TO_CODE: Record<string, string> = {
  원장: 'GRADE_CEO',
  부원장: 'GRADE_VP',
  수석전문위원: 'GRADE_CHIEF',
  책임전문위원: 'GRADE_LEAD',
  선임전문위원: 'GRADE_SENIOR',
  전문위원: 'GRADE_EXPERT',
  연구원: 'GRADE_RESEARCHER',
  전문원: 'GRADE_SPECIALIST',
  인턴: 'GRADE_INTERN',
};

/** 배열 순서 = 직책 랭킹 (앞일수록 상위) */
export const DEFAULT_USER_DUTY_OPTIONS: UserJobOption[] = [
  { code: 'DUTY_CEO', label: '원장', value: 'CEO' },
  { code: 'DUTY_VP', label: '부원장', value: 'Vice President' },
  { code: 'DUTY_EXEC', label: '상무', value: 'Executive Director' },
  { code: 'DUTY_HQ', label: '본부장', value: 'Director' },
  { code: 'DUTY_CENTER', label: '센터장', value: 'Manager' },
  { code: 'DUTY_MEMBER', label: '팀원', value: '' },
];

/** 배열 순서 = 직급 랭킹 (앞일수록 상위) */
export const DEFAULT_USER_GRADE_OPTIONS: UserJobOption[] = [
  { code: 'GRADE_CEO', label: '원장', value: 'CEO' },
  { code: 'GRADE_VP', label: '부원장', value: 'Vice President' },
  { code: 'GRADE_CHIEF', label: '수석전문위원', value: 'Chief Expert Advisor' },
  { code: 'GRADE_LEAD', label: '책임전문위원', value: 'Chief Technical Expert' },
  { code: 'GRADE_SENIOR', label: '선임전문위원', value: 'Senior Technical Expert' },
  { code: 'GRADE_EXPERT', label: '전문위원', value: 'Technical Expert' },
  { code: 'GRADE_RESEARCHER', label: '연구원', value: 'Researcher' },
  { code: 'GRADE_SPECIALIST', label: '전문원', value: 'Specialist' },
  { code: 'GRADE_INTERN', label: '인턴', value: 'Intern' },
];

/** 마케팅 공유 칩에 쓸 직책 (팀원 제외) */
export const MARKETING_DUTY_CODES = [
  'DUTY_CEO',
  'DUTY_VP',
  'DUTY_EXEC',
  'DUTY_HQ',
  'DUTY_CENTER',
] as const;

export function normalizeDutyCode(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!s) return '';
  if (s.startsWith('DUTY_')) return s;
  const fromLabel = LEGACY_DUTY_LABEL_TO_CODE[String(raw ?? '').trim()];
  return fromLabel || s;
}

export function normalizeGradeCode(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!s) return '';
  if (s.startsWith('GRADE_')) return s;
  const fromLabel = LEGACY_GRADE_LABEL_TO_CODE[String(raw ?? '').trim()];
  return fromLabel || '';
}

/** 한글 직책명 → 기본 코드 (없으면 빈 문자열 · 저장 시 DUTY_CUSTOM_n 부여) */
export function suggestDutyCode(label: string): string {
  const key = String(label ?? '').trim();
  if (!key) return '';
  return LEGACY_DUTY_LABEL_TO_CODE[key] || '';
}

/** 한글 직급명 → 기본 코드 */
export function suggestGradeCode(label: string): string {
  const key = String(label ?? '').trim();
  if (!key) return '';
  return LEGACY_GRADE_LABEL_TO_CODE[key] || '';
}

function normalizeUserJobOptionsBase(
  raw: unknown,
  kind: 'duty' | 'grade'
): UserJobOption[] {
  if (!Array.isArray(raw)) return [];
  const withCode = true;
  const legacy = kind === 'duty' ? LEGACY_DUTY_LABEL_TO_CODE : LEGACY_GRADE_LABEL_TO_CODE;
  const prefix = kind === 'duty' ? 'DUTY' : 'GRADE';
  const normalize = kind === 'duty' ? normalizeDutyCode : normalizeGradeCode;

  const out: UserJobOption[] = [];
  const seenLabel = new Set<string>();
  const seenCode = new Set<string>();
  let autoIdx = 0;
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const label = String((row as { label?: unknown }).label ?? '').trim();
    const value = String((row as { value?: unknown }).value ?? '').trim();
    if (!label) continue;
    const labelKey = label.toLowerCase();
    if (seenLabel.has(labelKey)) continue;
    seenLabel.add(labelKey);

    if (!withCode) {
      out.push({ label, value });
      continue;
    }

    let code = normalize((row as { code?: unknown }).code);
    if (!code) code = legacy[label] || '';
    if (!code) {
      autoIdx += 1;
      code = `${prefix}_CUSTOM_${autoIdx}`;
    }
    if (seenCode.has(code)) {
      autoIdx += 1;
      code = `${code}_${autoIdx}`;
    }
    seenCode.add(code);
    out.push({ code, label, value });
  }
  return out;
}

/** @deprecated 직급도 code 포함 — normalizeUserGradeOptions 사용 */
export function normalizeUserJobOptions(raw: unknown): UserJobOption[] {
  return normalizeUserGradeOptions(raw);
}

/** 직책: code 필수(보정 포함) */
export function normalizeUserDutyOptions(raw: unknown): UserJobOption[] {
  return normalizeUserJobOptionsBase(raw, 'duty');
}

/** 직급: code 필수(보정 포함) */
export function normalizeUserGradeOptions(raw: unknown): UserJobOption[] {
  return normalizeUserJobOptionsBase(raw, 'grade');
}

export function resolveUserDutyOptions(raw?: unknown): UserJobOption[] {
  const list = normalizeUserDutyOptions(raw);
  return list.length > 0 ? list : [...DEFAULT_USER_DUTY_OPTIONS];
}

export function resolveUserGradeOptions(raw?: unknown): UserJobOption[] {
  const list = normalizeUserGradeOptions(raw);
  return list.length > 0 ? list : [...DEFAULT_USER_GRADE_OPTIONS];
}

/** User.duty(한글) 또는 코드 → 정규화 코드 */
export function resolveDutyCode(
  dutyOrCode: string | null | undefined,
  options?: UserJobOption[] | null
): string {
  const raw = String(dutyOrCode ?? '').trim();
  if (!raw) return '';
  const opts = options && options.length > 0 ? options : DEFAULT_USER_DUTY_OPTIONS;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (upper.startsWith('DUTY_')) {
    const hit = opts.find((o) => normalizeDutyCode(o.code) === upper);
    return hit ? normalizeDutyCode(hit.code) : upper;
  }
  const byLabel = opts.find((o) => o.label === raw);
  if (byLabel?.code) return normalizeDutyCode(byLabel.code);
  return LEGACY_DUTY_LABEL_TO_CODE[raw] || '';
}

export function resolveDutyLabel(
  dutyOrCode: string | null | undefined,
  options?: UserJobOption[] | null
): string {
  const raw = String(dutyOrCode ?? '').trim();
  if (!raw) return '';
  const opts = options && options.length > 0 ? options : DEFAULT_USER_DUTY_OPTIONS;
  const code = resolveDutyCode(raw, opts);
  if (code) {
    const hit = opts.find((o) => normalizeDutyCode(o.code) === code);
    if (hit?.label) return hit.label;
  }
  const byLabel = opts.find((o) => o.label === raw);
  return byLabel?.label || raw;
}

export function resolveGradeCode(
  gradeOrCode: string | null | undefined,
  options?: UserJobOption[] | null
): string {
  const raw = String(gradeOrCode ?? '').trim();
  if (!raw) return '';
  const opts = options && options.length > 0 ? options : DEFAULT_USER_GRADE_OPTIONS;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (upper.startsWith('GRADE_')) {
    const hit = opts.find((o) => normalizeGradeCode(o.code) === upper);
    return hit ? normalizeGradeCode(hit.code) : upper;
  }
  const byLabel = opts.find((o) => o.label === raw);
  if (byLabel?.code) return normalizeGradeCode(byLabel.code);
  return LEGACY_GRADE_LABEL_TO_CODE[raw] || '';
}

/** 마케팅 칩용 직책 목록 (코드 있는 항목, 팀원 제외 기본) */
export function marketingDutyChipOptions(options?: UserJobOption[] | null): UserJobOption[] {
  const opts = resolveUserDutyOptions(options);
  const allow = new Set<string>(MARKETING_DUTY_CODES);
  const fromAllow = opts.filter((o) => o.code && allow.has(normalizeDutyCode(o.code)));
  if (fromAllow.length > 0) return fromAllow;
  return opts.filter((o) => {
    const c = normalizeDutyCode(o.code);
    return !!c && c !== 'DUTY_MEMBER';
  });
}

/**
 * 이전 옵션 → 새 옵션 라벨/영문 변경분 (코드·영문·레거시 라벨로 매칭)
 * 옵션 한글명 변경 시 User.duty/grade 동기화에 사용
 */
export function findJobOptionRenames(
  prev: UserJobOption[],
  next: UserJobOption[],
  kind: 'duty' | 'grade'
): Array<{ fromLabel: string; toLabel: string; toEn: string }> {
  const normalize = kind === 'duty' ? normalizeDutyCode : normalizeGradeCode;
  const legacy = kind === 'duty' ? LEGACY_DUTY_LABEL_TO_CODE : LEGACY_GRADE_LABEL_TO_CODE;
  const usedNextCodes = new Set<string>();
  const out: Array<{ fromLabel: string; toLabel: string; toEn: string }> = [];

  const resolveNext = (old: UserJobOption): UserJobOption | undefined => {
    const oldLabel = String(old.label || '').trim();
    const oldCode =
      (old.code ? normalize(old.code) : '') ||
      (oldLabel ? legacy[oldLabel] || '' : '');
    if (oldCode) {
      const byCode = next.find((n) => normalize(n.code) === oldCode);
      if (byCode && !usedNextCodes.has(normalize(byCode.code))) return byCode;
    }
    const oldEn = String(old.value || '').trim();
    if (oldEn) {
      const byEn = next.filter(
        (n) =>
          String(n.value || '').trim() === oldEn &&
          !usedNextCodes.has(normalize(n.code))
      );
      if (byEn.length === 1) return byEn[0];
    }
    return undefined;
  };

  for (const old of prev) {
    const fromLabel = String(old.label || '').trim();
    if (!fromLabel) continue;
    const matched = resolveNext(old);
    if (!matched) continue;
    const code = normalize(matched.code);
    if (code) usedNextCodes.add(code);
    const toLabel = String(matched.label || '').trim();
    const toEn = String(matched.value || '').trim();
    if (fromLabel === toLabel && String(old.value || '').trim() === toEn) continue;
    out.push({ fromLabel, toLabel, toEn });
  }
  return out;
}

/**
 * 사용자에 저장된 한글/영문이 옵션과 어긋날 때, 코드·레거시·영문으로 현재 옵션에 재매핑
 */
export function matchJobOptionForStored(
  storedLabel: string | null | undefined,
  storedEn: string | null | undefined,
  options: UserJobOption[],
  kind: 'duty' | 'grade'
): UserJobOption | null {
  const label = String(storedLabel ?? '').trim();
  const en = String(storedEn ?? '').trim();
  if (!label && !en) return null;

  const byLabel = options.find((o) => o.label === label);
  if (byLabel) {
    // 한글은 맞는데 영문만 다를 수 있음 → 호출측에서 en 갱신
    return byLabel;
  }

  const normalize = kind === 'duty' ? normalizeDutyCode : normalizeGradeCode;
  const legacy = kind === 'duty' ? LEGACY_DUTY_LABEL_TO_CODE : LEGACY_GRADE_LABEL_TO_CODE;

  if (label) {
    const code =
      (kind === 'duty' ? resolveDutyCode(label, options) : resolveGradeCode(label, options)) ||
      legacy[label] ||
      normalize(label);
    if (code) {
      const byCode = options.find((o) => normalize(o.code) === code);
      if (byCode) return byCode;
    }
  }

  if (en) {
    const byEn = options.filter((o) => String(o.value || '').trim() === en);
    if (byEn.length === 1) return byEn[0];
  }

  return null;
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
