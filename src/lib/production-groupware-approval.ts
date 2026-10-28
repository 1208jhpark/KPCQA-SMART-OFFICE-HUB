/** 사무문구 묶음발주 — 그룹웨어 전자결재 기안 바로가기 */

export const DEFAULT_PROD_GROUPWARE_APPROVAL_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=66';

export function resolveProdGroupwareApprovalUrl(raw?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return DEFAULT_PROD_GROUPWARE_APPROVAL_URL;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return DEFAULT_PROD_GROUPWARE_APPROVAL_URL;
    }
    return u.toString();
  } catch {
    return DEFAULT_PROD_GROUPWARE_APPROVAL_URL;
  }
}
