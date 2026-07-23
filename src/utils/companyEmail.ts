/** 사내 메일 도메인 — 가입/로그인은 로컬파트만 입력, DB에는 전체 주소 저장 */

export const COMPANY_EMAIL_DOMAIN = 'kpcqa.or.kr';
export const COMPANY_EMAIL_SUFFIX = `@${COMPANY_EMAIL_DOMAIN}`;

/** 로컬파트만 추출 (@ 이후·공백 제거). 빈 값이면 '' */
export function extractEmailLocalPart(raw: string | null | undefined): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const at = s.indexOf('@');
  if (at >= 0) return s.slice(0, at).replace(/\s+/g, '');
  return s.replace(/\s+/g, '');
}

/**
 * 입력(로컬파트 또는 전체 메일) → `local@kpcqa.or.kr`
 * - 다른 도메인이면 null
 * - 로컬파트 비면 null
 */
export function resolveCompanyEmail(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;

  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    if (!local || !domain) return null;
    if (domain !== COMPANY_EMAIL_DOMAIN) return null;
    return `${local}${COMPANY_EMAIL_SUFFIX}`;
  }

  const local = extractEmailLocalPart(s);
  if (!local) return null;
  return `${local}${COMPANY_EMAIL_SUFFIX}`;
}
