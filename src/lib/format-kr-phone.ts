/**
 * 국내 연락처 입력용 — 숫자만 받아 하이픈 표시.
 * - 서울(02): 02-xxx-xxxx / 02-xxxx-xxxx (예: 02-6973-0000)
 * - 그 외(휴대·지역): 000-000-0000 / 000-0000-0000 (예: 010-1234-5678)
 */
export function formatKrPhoneInput(value: string): string {
  const digits = String(value || '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, 11);

  if (!digits) return '';

  // 서울 02 (최대 10자리)
  if (digits.startsWith('02')) {
    const d = digits.slice(0, 10);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  if (digits.length <= 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
