/**
 * 그룹웨어 메일 작성 바로가기 URL
 *
 * 전체 주소 예:
 *   .../writeMailView.do?kind=plain&token=…&ssoType=GW&currentemail=…&pageTitle=…&gwUrl=…
 *
 * 저장용(고정): kind, ssoType, pageTitle, gwUrl
 * 저장 금지: token(세션 일회성), currentemail(개인 — 열 때 로그인 계정으로 보강)
 */

export const DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL =
  'https://ep.kpcqa.or.kr/mail2/writeMailView.do?kind=plain&ssoType=GW&pageTitle=%ED%95%9C%EA%B5%AD%EC%83%9D%EC%82%B0%EC%84%B1%EB%B3%B8%EB%B6%80%EC%9D%B8%EC%A6%9D%EC%9B%90&gwUrl=https%3A%2F%2Fep.kpcqa.or.kr';

const EPHEMERAL_KEYS = ['token'] as const;
const PERSONAL_KEYS = ['currentemail'] as const;

/** DB·개인설정에 넣을 고정 URL (token·currentemail 제거, 필수 쿼리 보강) */
export function sanitizeGroupwareMailShortcutUrl(raw?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
  try {
    const u = new URL(t);
    for (const key of EPHEMERAL_KEYS) u.searchParams.delete(key);
    for (const key of PERSONAL_KEYS) u.searchParams.delete(key);
    if (!u.searchParams.get('kind')) u.searchParams.set('kind', 'plain');
    if (!u.searchParams.get('ssoType')) u.searchParams.set('ssoType', 'GW');
    if (!u.searchParams.get('gwUrl')) {
      u.searchParams.set('gwUrl', 'https://ep.kpcqa.or.kr');
    }
    // `...?` 만 있는 경우 search가 비어 세션 오류 → 기본 쿼리로 보정
    if (![...u.searchParams.keys()].length) {
      return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
    }
    return u.toString();
  } catch {
    return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
  }
}

export function resolveGroupwareMailShortcutUrl(raw?: string | null): string {
  return sanitizeGroupwareMailShortcutUrl(raw);
}

/** 바로가기 열기용 — 로그인 메일 보강 */
export function buildGroupwareMailOpenUrl(
  storedUrl?: string | null,
  currentEmail?: string | null
): string {
  const base = sanitizeGroupwareMailShortcutUrl(storedUrl);
  const email = String(currentEmail || '').trim();
  if (!email) return base;
  try {
    const u = new URL(base);
    if (!u.searchParams.get('currentemail')) {
      u.searchParams.set('currentemail', email);
    }
    return u.toString();
  } catch {
    return base;
  }
}
