/** 법인카드 — 그룹웨어 사용신청서 기안 바로가기 */

export const DEFAULT_CORP_CARD_GROUPWARE_URL =
  'https://ep.kpcqa.or.kr/ea/edoc/eapproval/docCommonDrafWrite.do?template_key=43';

export function resolveCorpCardGroupwareUrl(raw?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return DEFAULT_CORP_CARD_GROUPWARE_URL;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return DEFAULT_CORP_CARD_GROUPWARE_URL;
    }
    return u.toString();
  } catch {
    return DEFAULT_CORP_CARD_GROUPWARE_URL;
  }
}
