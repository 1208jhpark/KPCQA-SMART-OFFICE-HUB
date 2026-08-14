/**
 * Hub 세션 쿠키 옵션
 * - 사내망 HTTP 배포: secure=false 여야 브라우저가 쿠키를 저장함
 * - HTTPS(BASE_URL)일 때만 secure=true
 */
export function hubCookieSecure(): boolean {
  const base = String(
    process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || ''
  ).trim();
  return /^https:\/\//i.test(base);
}

export function hubTokenCookieOptions(maxAgeSeconds = 60 * 60 * 24) {
  return {
    httpOnly: true,
    secure: hubCookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** 모바일 HTTP 등 Set-Cookie가 막힐 때 sessionStorage 폴백 키 */
export const MOBILE_ACCESS_TOKEN_KEY = 'soh_mobile_access_token';

export function readMobileAccessToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(sessionStorage.getItem(MOBILE_ACCESS_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writeMobileAccessToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    const t = String(token || '').trim();
    if (t) sessionStorage.setItem(MOBILE_ACCESS_TOKEN_KEY, t);
    else sessionStorage.removeItem(MOBILE_ACCESS_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

/** fetch headers: 쿠키 + Bearer 폴백 */
export function mobileAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = readMobileAccessToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
