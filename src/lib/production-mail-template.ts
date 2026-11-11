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
  DEPT_NAME: '{{DEPT_NAME}}',
  SENDER_NAME: '{{SENDER_NAME}}',
  CATEGORY: '{{CATEGORY}}',
  /** 발주 시 입력한 실배송지 — 사무문구 메일 등에 사용 */
  SHIPPING_ADDRESS: '{{SHIPPING_ADDRESS}}',
} as const;

/** 그룹웨어 메일 작성 기본 URL — DB 미설정·빈 값일 때 사용 (개인설정에서 변경 가능) */
export const DEFAULT_PROD_MAIL_SHORTCUT_URL = DEFAULT_GROUPWARE_MAIL_SHORTCUT_URL;

export const DEFAULT_PROD_MAIL_SUBJECT =
  `한국생산성본부인증원 제작 요청 (${PROD_MAIL_PLACEHOLDERS.BATCH_NO})`;

export const DEFAULT_PROD_MAIL_BODY = `안녕하세요, ${PROD_MAIL_PLACEHOLDERS.VENDOR_NAME} ${PROD_MAIL_PLACEHOLDERS.VENDOR_MANAGER}님.
한국생산성본부인증원 ${PROD_MAIL_PLACEHOLDERS.DEPT_NAME} ${PROD_MAIL_PLACEHOLDERS.SENDER_NAME} 입니다.

[${PROD_MAIL_PLACEHOLDERS.CATEGORY}] 발주서를 송부해 드립니다.
첨부된 발주서(엑셀) 내 정보를 확인하여 제작을 부탁드립니다.

- 첨부파일: ${PROD_MAIL_PLACEHOLDERS.BATCH_NO}
- 첨부파일 내 총 건수: ${PROD_MAIL_PLACEHOLDERS.COUNT}건

감사합니다.`;

export const DEFAULT_PROD_MAIL_BODY_OFFICE = `안녕하세요, ${PROD_MAIL_PLACEHOLDERS.VENDOR_NAME} ${PROD_MAIL_PLACEHOLDERS.VENDOR_MANAGER}님.
한국생산성본부인증원 ${PROD_MAIL_PLACEHOLDERS.DEPT_NAME} ${PROD_MAIL_PLACEHOLDERS.SENDER_NAME} 입니다.

[${PROD_MAIL_PLACEHOLDERS.CATEGORY}] 견적서를 송부해 드립니다.
첨부된 견적서를 확인하여 배송을 부탁드립니다.

- 첨부파일: ${PROD_MAIL_PLACEHOLDERS.BATCH_NO}

감사합니다.`;

export type ProdMailTemplateVars = {
  batchNo: string;
  count: number | string;
  vendorName?: string;
  vendorManager?: string;
  shippingAddress?: string;
  deptName?: string;
  senderName?: string;
  category?: string;
};

/** 메일 본문 코너명: 현판 / 제본 / 제작물 */
export function prodMailCategoryLabel(
  kind: 'sign' | 'jebon' | 'print' | 'office' | 'other' | string
): string {
  if (kind === 'sign' || kind === 'SIGN') return '현판';
  if (kind === 'jebon' || kind === 'JEBON') return '제본';
  if (kind === 'print' || kind === 'PRINT') return '제작물';
  if (kind === 'office' || kind === 'OFFICE_SUPPLIES') return '사무문구류';
  return '제작물';
}

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
    .replaceAll(PROD_MAIL_PLACEHOLDERS.DEPT_NAME, String(vars.deptName || '부서'))
    .replaceAll(PROD_MAIL_PLACEHOLDERS.SENDER_NAME, String(vars.senderName || '담당자'))
    .replaceAll(PROD_MAIL_PLACEHOLDERS.CATEGORY, String(vars.category || '제작물'))
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
  const t = String(raw || '')
    .replace(/^\[제작물\s?발주\]\s*/u, '')
    .trim();
  return t || DEFAULT_PROD_MAIL_SUBJECT;
}

function normalizeMailBody(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

const REQUIRED_PROD_MAIL_ORDER_LINE =
  '첨부된 발주서(엑셀) 내 정보를 확인하여 제작을 부탁드립니다.';
const REQUIRED_PROD_MAIL_OFFICE_LINE =
  '첨부된 견적서를 확인하여 배송을 부탁드립니다.';

export function resolveProdMailBodyTemplate(
  raw?: string | null,
  category?: string
): string {
  const t = normalizeMailBody(String(raw || ''));
  const isOffice = category === 'office' || category === 'OFFICE_SUPPLIES';
  if (isOffice) {
    if (t.includes(REQUIRED_PROD_MAIL_OFFICE_LINE)) return t;
    return DEFAULT_PROD_MAIL_BODY_OFFICE;
  }
  if (t.includes(REQUIRED_PROD_MAIL_ORDER_LINE)) return t;
  return DEFAULT_PROD_MAIL_BODY;
}
