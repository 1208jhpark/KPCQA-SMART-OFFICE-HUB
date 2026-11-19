/**
 * 법인카드 — 그룹웨어 사용신청서 기안 바로가기
 *
 * 신형(gw SPA popup):
 *   https://gw.kpcqa.or.kr/#/popup?MicroModuleCode=ea&tiKeyCode=mg_43&callComp=UCAP001
 *   - popupUUID 등 일회성 값은 저장·기본값에서 제외 (튕김 방지)
 *
 * 구형(ep):
 *   .../docCommonDrafWrite.do?template_key=43
 */

/** 법인카드 사용신청서(template mg_43) — 세션 UUID 제외한 고정 경로 */
export const DEFAULT_CORP_CARD_GROUPWARE_URL =
  'https://gw.kpcqa.or.kr/#/popup?MicroModuleCode=ea&tiKeyCode=mg_43&callComp=UCAP001';

const EPHEMERAL_HASH_KEYS = [
  'popupUUID',
  'popupUuid',
  'uuid',
  'token',
  'access_token',
  'jsessionid',
] as const;

function parseHashRoute(hash: string): { path: string; params: URLSearchParams } {
  const raw = String(hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return { path: raw || '/popup', params: new URLSearchParams() };
  return {
    path: raw.slice(0, q) || '/popup',
    params: new URLSearchParams(raw.slice(q + 1)),
  };
}

function buildHashRoute(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  const p = path.startsWith('/') ? path : `/${path}`;
  return qs ? `#${p}?${qs}` : `#${p}`;
}

function isLegacyEpCorpCardUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (!host.includes('ep.kpcqa')) return false;
  if (!path.includes('doccommondrafwrite.do') && !path.includes('eapproval')) return false;
  const key = u.searchParams.get('template_key') || '';
  return key === '43' || key === '';
}

function isGwCorpCardPopup(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const hash = u.hash || '';
  return (
    host.includes('gw.kpcqa') ||
    hash.includes('tiKeyCode=mg_43') ||
    (hash.includes('#/popup') && hash.includes('MicroModuleCode=ea'))
  );
}

function sanitizeGwCorpCardUrl(u: URL): string {
  const { path, params } = parseHashRoute(u.hash);
  for (const key of EPHEMERAL_HASH_KEYS) params.delete(key);

  if (!params.get('MicroModuleCode')) params.set('MicroModuleCode', 'ea');
  if (!params.get('tiKeyCode')) params.set('tiKeyCode', 'mg_43');
  if (!params.get('callComp')) params.set('callComp', 'UCAP001');

  const next = new URL(u.origin);
  const routePath = path.includes('popup') ? path : '/popup';
  next.hash = buildHashRoute(routePath, params);
  return next.toString();
}

export function resolveCorpCardGroupwareUrl(raw?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return DEFAULT_CORP_CARD_GROUPWARE_URL;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return DEFAULT_CORP_CARD_GROUPWARE_URL;
    }
    // 구형 ep template_key=43 → 신형 gw
    if (isLegacyEpCorpCardUrl(u)) return DEFAULT_CORP_CARD_GROUPWARE_URL;
    if (isGwCorpCardPopup(u) || (u.hash && u.hash.includes('popup'))) {
      return sanitizeGwCorpCardUrl(u);
    }
    return u.toString();
  } catch {
    return DEFAULT_CORP_CARD_GROUPWARE_URL;
  }
}
