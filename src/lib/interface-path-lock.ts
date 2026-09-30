/**
 * admin/interface 민감 설정 잠금 (배포 중 오수정 방지)
 *
 * 잠금 대상:
 * - 메뉴 path
 * - Step1/2 진입로(l2_entry_mode) · 목록 Entry Mode
 * - View Scope (view_scopes)
 * - Edit Scope (edit_scopes)
 *
 * 해제: .env 에 아래 중 하나 true 후 서버 재시작
 *   ALLOW_INTERFACE_PATH_EDIT=true
 *   NEXT_PUBLIC_ALLOW_INTERFACE_PATH_EDIT=true  (UI 표시용, build 필요)
 */
export const INTERFACE_ADVANCED_LOCK_FIELDS = [
  'path',
  'l2_entry_mode',
  'view_scopes',
  'edit_scopes',
] as const;

export function isInterfaceAdvancedEditable(): boolean {
  return (
    process.env.ALLOW_INTERFACE_PATH_EDIT === 'true' ||
    process.env.NEXT_PUBLIC_ALLOW_INTERFACE_PATH_EDIT === 'true'
  );
}

/** @deprecated 이름 호환 — isInterfaceAdvancedEditable 과 동일 */
export function isInterfacePathEditable(): boolean {
  return isInterfaceAdvancedEditable();
}

export function payloadTouchesInterfaceLock(
  payload: Record<string, unknown>
): boolean {
  return INTERFACE_ADVANCED_LOCK_FIELDS.some((k) =>
    Object.prototype.hasOwnProperty.call(payload, k)
  );
}
