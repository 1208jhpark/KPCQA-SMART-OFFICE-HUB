/** 제작 외주 메일 양식 — 부서 설정용 플레이스홀더 */

export const PROD_MAIL_PLACEHOLDERS = {
  BATCH_NO: '{{BATCH_NO}}',
  COUNT: '{{COUNT}}',
  VENDOR_NAME: '{{VENDOR_NAME}}',
  VENDOR_MANAGER: '{{VENDOR_MANAGER}}',
} as const;

export const DEFAULT_PROD_MAIL_SUBJECT =
  `[제작물발주] 한국생산성본부인증원 제작 요청 (${PROD_MAIL_PLACEHOLDERS.BATCH_NO})`;

export const DEFAULT_PROD_MAIL_BODY = `안녕하세요, ${PROD_MAIL_PLACEHOLDERS.VENDOR_NAME} ${PROD_MAIL_PLACEHOLDERS.VENDOR_MANAGER}님.
한국생산성본부인증원 제작물 담당자입니다.

금일 발주 확정된 제작 리스트 총 ${PROD_MAIL_PLACEHOLDERS.COUNT}건 송부해 드립니다.
첨부된 엑셀 데이터로 제작 부탁드립니다.

- 발주 번호: ${PROD_MAIL_PLACEHOLDERS.BATCH_NO}
- 총 건수: ${PROD_MAIL_PLACEHOLDERS.COUNT}건

감사합니다.`;

export type ProdMailTemplateVars = {
  batchNo: string;
  count: number | string;
  vendorName?: string;
  vendorManager?: string;
};

export function applyProdMailTemplate(
  template: string,
  vars: ProdMailTemplateVars
): string {
  return String(template || '')
    .replaceAll(PROD_MAIL_PLACEHOLDERS.BATCH_NO, String(vars.batchNo || ''))
    .replaceAll(PROD_MAIL_PLACEHOLDERS.COUNT, String(vars.count ?? ''))
    .replaceAll(PROD_MAIL_PLACEHOLDERS.VENDOR_NAME, String(vars.vendorName || '업체'))
    .replaceAll(
      PROD_MAIL_PLACEHOLDERS.VENDOR_MANAGER,
      String(vars.vendorManager || '담당자')
    );
}

export function resolveProdMailSubjectTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_PROD_MAIL_SUBJECT;
}

export function resolveProdMailBodyTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_PROD_MAIL_BODY;
}
