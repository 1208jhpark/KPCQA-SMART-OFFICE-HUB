/**
 * 그룹웨어 메일 작성 바로가기 URL
 *
 * 신형(gw SPA):
 *   https://gw.kpcqa.or.kr/#/UD/UDA/UDA0000?specialLnb=Y&moduleCode=UD&menuCode=UDA&pageCode=UDA0140&mailKind=plain
 *   - 해시 라우트: 고정 메뉴 쿼리만 유지 (세션 token·개인 currentemail 제거)
 *
 * 구형(ep writeMailView):
 *   .../writeMailView.do?kind=plain&token=…&ssoType=GW&currentemail=…&pageTitle=…&gwUrl=…
 *   - 저장용(고정): kind, ssoType, pageTitle, gwUrl
 *   - 저장 금지: token(세션 일회성), currentemail(개인 — 열 때 로그인 계정으로 보강)
 */

/** 메일 작성(일반) — 튕김 적은 고정 메뉴 경로 */
export const DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL =
  'https://gw.kpcqa.or.kr/#/UD/UDA/UDA0000?specialLnb=Y&moduleCode=UD&menuCode=UDA&pageCode=UDA0140&mailKind=plain';

const EPHEMERAL_KEYS = ['token', 'access_token', 'refresh_token', 'jsessionid'] as const;
const PERSONAL_KEYS = ['currentemail'] as const;

function isGwSpaMailUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const hash = u.hash || '';
  return host.includes('gw.kpcqa') || hash.includes('/UD/UDA/') || hash.includes('UDA0000');
}

function isEpWriteMailUrl(u: URL): boolean {
  return u.pathname.toLowerCase().includes('writemailview.do');
}

/** 해시 `#/path?a=1&b=2` → path + query map */
function parseHashRoute(hash: string): { path: string; params: URLSearchParams } {
  const raw = String(hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return { path: raw || '/UD/UDA/UDA0000', params: new URLSearchParams() };
  return {
    path: raw.slice(0, q) || '/UD/UDA/UDA0000',
    params: new URLSearchParams(raw.slice(q + 1)),
  };
}

function buildHashRoute(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  const p = path.startsWith('/') ? path : `/${path}`;
  return qs ? `#${p}?${qs}` : `#${p}`;
}

/** gw SPA 메일 작성 — 고정 메뉴 쿼리만 남김 */
function sanitizeGwSpaMailUrl(u: URL): string {
  const { path, params } = parseHashRoute(u.hash);
  for (const key of EPHEMERAL_KEYS) params.delete(key);
  for (const key of PERSONAL_KEYS) params.delete(key);

  // 메일 작성 화면으로 안정 진입
  if (!params.get('moduleCode')) params.set('moduleCode', 'UD');
  if (!params.get('menuCode')) params.set('menuCode', 'UDA');
  if (!params.get('pageCode')) params.set('pageCode', 'UDA0140');
  if (!params.get('mailKind')) params.set('mailKind', 'plain');
  if (!params.get('specialLnb')) params.set('specialLnb', 'Y');

  const next = new URL(u.origin);
  // origin search 에 붙은 세션성 쿼리는 제거 (튕김 원인)
  next.hash = buildHashRoute(path.includes('UDA0000') ? path : '/UD/UDA/UDA0000', params);
  return next.toString();
}

/** 구형 ep writeMailView */
function sanitizeEpWriteMailUrl(u: URL): string {
  for (const key of EPHEMERAL_KEYS) u.searchParams.delete(key);
  for (const key of PERSONAL_KEYS) u.searchParams.delete(key);
  if (!u.searchParams.get('kind')) u.searchParams.set('kind', 'plain');
  if (!u.searchParams.get('ssoType')) u.searchParams.set('ssoType', 'GW');
  if (!u.searchParams.get('gwUrl')) {
    u.searchParams.set('gwUrl', 'https://ep.kpcqa.or.kr');
  }
  if (![...u.searchParams.keys()].length) {
    return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
  }
  return u.toString();
}

/** DB·개인설정에 넣을 고정 URL (token·currentemail 제거, 필수 쿼리 보강) */
export function sanitizeGroupwareMailShortcutUrl(raw?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
  try {
    const u = new URL(t);
    // 구형 ep 메일 작성창 → 신형 gw 메일 메뉴로 교체 (세션 URL 튕김 방지)
    if (isEpWriteMailUrl(u) && u.hostname.toLowerCase().includes('ep.kpcqa')) {
      return DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;
    }
    if (isGwSpaMailUrl(u)) return sanitizeGwSpaMailUrl(u);
    if (isEpWriteMailUrl(u)) return sanitizeEpWriteMailUrl(u);

    // 알 수 없는 형태 — 최소한 ephemeral만 제거
    for (const key of EPHEMERAL_KEYS) u.searchParams.delete(key);
    for (const key of PERSONAL_KEYS) u.searchParams.delete(key);
    if (u.hash && u.hash.includes('UDA')) return sanitizeGwSpaMailUrl(u);
    if (![...u.searchParams.keys()].length && !u.hash) {
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

/** 바로가기 열기용 — 구형 ep 만 로그인 메일 보강 (gw SPA 는 해시만 사용) */
export function buildGroupwareMailOpenUrl(
  storedUrl?: string | null,
  currentEmail?: string | null
): string {
  const base = sanitizeGroupwareMailShortcutUrl(storedUrl);
  try {
    const u = new URL(base);
    if (isGwSpaMailUrl(u)) return base;
    if (!isEpWriteMailUrl(u)) return base;
    const email = String(currentEmail || '').trim();
    if (!email) return base;
    if (!u.searchParams.get('currentemail')) {
      u.searchParams.set('currentemail', email);
    }
    return u.toString();
  } catch {
    return base;
  }
}
