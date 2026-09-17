/** 명함 외주 메일 양식 — 전사 설정용 플레이스홀더 */

export const BC_MAIL_PLACEHOLDERS = {
  BATCH_NO: '{{BATCH_NO}}',
  COUNT: '{{COUNT}}',
  VENDOR_NAME: '{{VENDOR_NAME}}',
  VENDOR_MANAGER: '{{VENDOR_MANAGER}}',
} as const;

export const DEFAULT_BC_MAIL_SUBJECT =
  `[명함발주] 한국생산성본부인증원 명함 제작 요청 (${BC_MAIL_PLACEHOLDERS.BATCH_NO})`;

export const DEFAULT_BC_MAIL_BODY = `안녕하세요, ${BC_MAIL_PLACEHOLDERS.VENDOR_NAME} ${BC_MAIL_PLACEHOLDERS.VENDOR_MANAGER}님.
한국생산성본부인증원 명함 신청 담당자입니다.

금일 발주 확정된 명함 리스트 총 ${BC_MAIL_PLACEHOLDERS.COUNT}건 송부해 드립니다.
첨부된 엑셀 데이터로 명함 제작 부탁드립니다.

- 발주 번호: ${BC_MAIL_PLACEHOLDERS.BATCH_NO}
- 총 수량: ${BC_MAIL_PLACEHOLDERS.COUNT}건

감사합니다.`;

export type BcMailTemplateVars = {
  batchNo: string;
  count: number | string;
  vendorName?: string;
  vendorManager?: string;
};

export function applyBcMailTemplate(template: string, vars: BcMailTemplateVars): string {
  return String(template || '')
    .replaceAll(BC_MAIL_PLACEHOLDERS.BATCH_NO, String(vars.batchNo || ''))
    .replaceAll(BC_MAIL_PLACEHOLDERS.COUNT, String(vars.count ?? ''))
    .replaceAll(BC_MAIL_PLACEHOLDERS.VENDOR_NAME, String(vars.vendorName || '업체'))
    .replaceAll(
      BC_MAIL_PLACEHOLDERS.VENDOR_MANAGER,
      String(vars.vendorManager || '담당자')
    );
}

export function resolveBcMailSubjectTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_BC_MAIL_SUBJECT;
}

export function resolveBcMailBodyTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_BC_MAIL_BODY;
}
