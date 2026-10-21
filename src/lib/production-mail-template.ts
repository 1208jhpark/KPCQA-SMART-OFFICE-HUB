/** 제작 외주 메일 양식 — 부서 설정용 플레이스홀더 */

import {
  DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL,
  resolveGroupwareMailShortcutUrl,
} from '@/lib/groupware-mail-shortcut';

export const PROD_MAIL_PLACEHOLDERS = {
  BATCH_NO: '{{BATCH_NO}}',
  COUNT: '{{COUNT}}',
  VENDOR_NAME: '{{VENDOR_NAME}}',
  VENDOR_MANAGER: '{{VENDOR_MANAGER}}',
  /** 발주 시 입력한 실배송지 — 사무문구 메일 등에 사용 */
  SHIPPING_ADDRESS: '{{SHIPPING_ADDRESS}}',
} as const;

/** 그룹웨어 메일 작성 기본 URL — DB 미설정·빈 값일 때 사용 (개인설정에서 변경 가능) */
export const DEFAULT_PROD_MAIL_SHORTCUT_URL = DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;

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
  shippingAddress?: string;
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
    )
    .replaceAll(
      PROD_MAIL_PLACEHOLDERS.SHIPPING_ADDRESS,
      String(vars.shippingAddress || '')
    );
}

/** 사무문구 등 — 템플릿에 {{SHIPPING_ADDRESS}}가 없을 때 본문 하단에 배송지 블록 추가 */
export function appendShippingAddressIfNeeded(
  body: string,
  opts: { shippingAddress: string; forceAppend: boolean; templateHasPlaceholder: boolean }
): string {
  if (!opts.forceAppend || opts.templateHasPlaceholder) return body;
  const addr = String(opts.shippingAddress || '').trim();
  const line = addr
    ? `- 배송지: ${addr}`
    : '- 배송지: (발주 시 입력한 주소 없음 — 배송지를 확인해 주세요)';
  const attach = '- 첨부: 드림디포 견적서';
  return `${String(body || '').replace(/\s+$/, '')}\n\n${line}\n${attach}`;
}

export function resolveProdMailShortcutUrl(raw?: string | null): string {
  return resolveGroupwareMailShortcutUrl(raw);
}

export function resolveProdMailSubjectTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_PROD_MAIL_SUBJECT;
}

export function resolveProdMailBodyTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_PROD_MAIL_BODY;
}
