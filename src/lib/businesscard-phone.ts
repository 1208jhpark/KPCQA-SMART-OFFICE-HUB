/** 전각 숫자 → 반각 */
function toAsciiDigits(value: string): string {
  return String(value || '').replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

/** 숫자만 추출 후, 이미 붙은 국가번호 82 정규화 → 국내 0-시작 형태로 */
function toDomesticDigits(value: string): string {
  let clean = toAsciiDigits(value).replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (clean.startsWith('82') && clean.length >= 11) {
    clean = clean.slice(2);
    if (!clean.startsWith('0')) clean = `0${clean}`;
  }
  return clean;
}

/** 저장된 영문번호 앞의 + 제거 (표시·엑셀용). 예: +82-10-… → 82-10-… */
export function stripBusinessCardEnPlus(value: string | null | undefined): string {
  return String(value || '').replace(/^\++/, '');
}

/**
 * 국문 전화/휴대 → 영문(82-) 표기.
 * 변환 불가 시에도 가능한 한 82- 접두를 붙이고, 국문 원문을 En에 그대로 넣지 않음.
 */
export function formatBusinessCardEnNumber(
  type: 'mobile' | 'phone' | 'fax',
  value: string
): string {
  const clean = toDomesticDigits(value);
  if (!clean) return '';

  if (type === 'mobile') {
    // 010/011/016/017/018/019 + 7~8자리
    if (/^01[016789]\d{7,8}$/.test(clean)) {
      const ndc = clean.slice(1, 3); // 10, 11, ...
      const rest = clean.slice(3);
      if (rest.length === 8) {
        return `82-${ndc}-${rest.slice(0, 4)}-${rest.slice(4)}`;
      }
      return `82-${ndc}-${rest.slice(0, 3)}-${rest.slice(3)}`;
    }
    if (clean.startsWith('0') && clean.length >= 10) {
      return `82-${clean.slice(1)}`;
    }
    return clean.startsWith('0') ? `82-${clean.slice(1)}` : `82-${clean}`;
  }

  // 유선(전화/팩스)
  if (clean.startsWith('02')) {
    const rest = clean.slice(2);
    if (rest.length === 7 || rest.length === 8) {
      const mid = rest.length === 8 ? rest.slice(0, 4) : rest.slice(0, 3);
      return `82-2-${mid}-${rest.slice(-4)}`;
    }
  } else if (clean.startsWith('0') && clean.length >= 9) {
    const areaCode = clean.slice(1, 3);
    const rest = clean.slice(3);
    if (rest.length === 7 || rest.length === 8) {
      const mid = rest.length === 8 ? rest.slice(0, 4) : rest.slice(0, 3);
      return `82-${areaCode}-${mid}-${rest.slice(-4)}`;
    }
  }

  if (clean.startsWith('0') && clean.length >= 8) {
    return `82-${clean.slice(1)}`;
  }
  return clean ? `82-${clean}` : '';
}
