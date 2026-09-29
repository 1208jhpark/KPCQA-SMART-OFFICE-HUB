/** 비밀번호 정책용 문자열 정규화 (공백·대소문자 무시 비교) */
export function normalizePasswordCandidate(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

/** 새 비밀번호가 사번과 동일한지 (빈 사번은 비교하지 않음) */
export function isPasswordSameAsEmployeeNo(
  newPassword: unknown,
  employeeNo: unknown
): boolean {
  const emp = normalizePasswordCandidate(employeeNo);
  if (!emp) return false;
  return normalizePasswordCandidate(newPassword) === emp;
}
