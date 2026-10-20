/** 명함 외주 메일 양식 — 전사 설정용 플레이스홀더 */

export const BC_MAIL_PLACEHOLDERS = {
  BATCH_NO: '{{BATCH_NO}}',
  COUNT: '{{COUNT}}',
  PACKS: '{{PACKS}}',
  VENDOR_NAME: '{{VENDOR_NAME}}',
  VENDOR_MANAGER: '{{VENDOR_MANAGER}}',
  APPLICANTS: '{{APPLICANTS}}',
} as const;

export const DEFAULT_BC_MAIL_SUBJECT =
  `[명함발주] 한국생산성본부인증원 명함 제작 요청 (${BC_MAIL_PLACEHOLDERS.BATCH_NO})`;

export const DEFAULT_BC_MAIL_BODY = `안녕하세요, ${BC_MAIL_PLACEHOLDERS.VENDOR_NAME} ${BC_MAIL_PLACEHOLDERS.VENDOR_MANAGER}님.
한국생산성본부인증원 명함 신청 담당자입니다.

금일 발주 확정된 명함 리스트 총 ${BC_MAIL_PLACEHOLDERS.COUNT}건(${BC_MAIL_PLACEHOLDERS.PACKS}통) 송부해 드립니다.
첨부된 엑셀 발주서 파일을 확인하여 명함 제작을 부탁드립니다.

- 발주 번호: ${BC_MAIL_PLACEHOLDERS.BATCH_NO}
- 신청인: ${BC_MAIL_PLACEHOLDERS.APPLICANTS}
- 총 수량: ${BC_MAIL_PLACEHOLDERS.COUNT}건 / ${BC_MAIL_PLACEHOLDERS.PACKS}통

감사합니다.`;

export type BcMailTemplateVars = {
  batchNo: string;
  /** 신청 건수 */
  count: number | string;
  /** 통수 합계 */
  packs?: number | string;
  vendorName?: string;
  vendorManager?: string;
  /** 신청인(대상자) 이름(통수) 목록 문구 */
  applicants?: string;
};

/** 묶음 내 대상자 이름 + 통수만 메일용 한 줄로 만든다 (이메일 제외) */
export function formatBcMailApplicants(
  items: Array<{ userName?: string | null; quantity?: number | null }>
): string {
  const parts = (items || [])
    .map((item) => {
      const name = String(item.userName || '').trim() || '-';
      const packs = Math.max(1, Number(item.quantity) || 1);
      return `${name}(${packs}통)`;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '(없음)';
}

/** 묶음 통수 합계 */
export function sumBcMailPacks(
  items: Array<{ quantity?: number | null }> | undefined | null
): number {
  return (items || []).reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
}

export function applyBcMailTemplate(template: string, vars: BcMailTemplateVars): string {
  return String(template || '')
    .replaceAll(BC_MAIL_PLACEHOLDERS.BATCH_NO, String(vars.batchNo || ''))
    .replaceAll(BC_MAIL_PLACEHOLDERS.COUNT, String(vars.count ?? ''))
    .replaceAll(BC_MAIL_PLACEHOLDERS.PACKS, String(vars.packs ?? ''))
    .replaceAll(BC_MAIL_PLACEHOLDERS.VENDOR_NAME, String(vars.vendorName || '업체'))
    .replaceAll(
      BC_MAIL_PLACEHOLDERS.VENDOR_MANAGER,
      String(vars.vendorManager || '담당자')
    )
    .replaceAll(BC_MAIL_PLACEHOLDERS.APPLICANTS, String(vars.applicants || '(없음)'));
}

export function resolveBcMailSubjectTemplate(raw?: string | null): string {
  const t = String(raw || '').trim();
  return t || DEFAULT_BC_MAIL_SUBJECT;
}

/** 저장된 구 양식에 신청인·통수 표기가 없으면 보완 */
export function resolveBcMailBodyTemplate(raw?: string | null): string {
  let t = String(raw || '').trim();
  if (!t) return DEFAULT_BC_MAIL_BODY;
  if (!t.includes(BC_MAIL_PLACEHOLDERS.APPLICANTS)) {
    const batchLine = `- 발주 번호: ${BC_MAIL_PLACEHOLDERS.BATCH_NO}`;
    if (t.includes(batchLine)) {
      t = t.replace(
        batchLine,
        `${batchLine}\n- 신청인: ${BC_MAIL_PLACEHOLDERS.APPLICANTS}`
      );
    }
  }
  // 구 양식: "- 총 수량: {{COUNT}}건" → 건/통
  if (
    t.includes(`- 총 수량: ${BC_MAIL_PLACEHOLDERS.COUNT}건`) &&
    !t.includes(BC_MAIL_PLACEHOLDERS.PACKS)
  ) {
    t = t.replace(
      `- 총 수량: ${BC_MAIL_PLACEHOLDERS.COUNT}건`,
      `- 총 수량: ${BC_MAIL_PLACEHOLDERS.COUNT}건 / ${BC_MAIL_PLACEHOLDERS.PACKS}통`
    );
  }
  // 구 본문 문장 교체
  t = t.replace(
    '첨부된 엑셀 발주서 파일의 각 담당자(이메일 확인)와 시안을 픽스 후 명함 제작을 부탁드립니다.',
    '첨부된 엑셀 발주서 파일을 확인하여 명함 제작을 부탁드립니다.'
  );
  if (
    t.includes(`총 ${BC_MAIL_PLACEHOLDERS.COUNT}건 송부`) &&
    !t.includes(BC_MAIL_PLACEHOLDERS.PACKS)
  ) {
    t = t.replace(
      `총 ${BC_MAIL_PLACEHOLDERS.COUNT}건 송부`,
      `총 ${BC_MAIL_PLACEHOLDERS.COUNT}건(${BC_MAIL_PLACEHOLDERS.PACKS}통) 송부`
    );
  }
  return t;
}
