/** 조직 고정 코드 정규화 — 대문자·영숫자 2~8자 */
export function normalizeOrgUnitCode(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function isValidOrgUnitCode(code: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(code);
}
