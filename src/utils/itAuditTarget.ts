/**
 * IT 실사 대상범위(target) ↔ 자산 부서 매칭
 * - target: 콤마 구분 조직명, '전사'면 전체
 */

export type AuditOrgUnit = {
  id?: string | null;
  unit_name?: string | null;
  parent_id?: string | null;
};

export function parseAuditTargets(target: string | null | undefined): string[] {
  return String(target || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A가 B의 상위(또는 동일) 조직인지 */
export function unitCoversAuditTarget(
  ancestorName: string,
  descendantName: string,
  units: AuditOrgUnit[]
): boolean {
  if (ancestorName === descendantName) return true;
  let current = units.find((u) => u.unit_name === descendantName);
  while (current?.parent_id) {
    const parent = units.find((u) => u.id === current!.parent_id);
    if (!parent) break;
    if (parent.unit_name === ancestorName) return true;
    current = parent;
  }
  return false;
}

/** 자산 부서가 해당 실사 target에 포함되는지 */
export function assetInAuditTarget(
  assetDept: string | null | undefined,
  target: string | null | undefined,
  units: AuditOrgUnit[]
): boolean {
  const dept = String(assetDept || '').trim();
  if (!dept) return false;
  const targets = parseAuditTargets(target);
  if (targets.length === 0) return false;
  if (targets.includes('전사')) return true;
  return targets.some((t) => unitCoversAuditTarget(t, dept, units));
}

/** 여러 실사 target 중 하나라도 포함되면 true */
export function assetInAnyAuditTarget(
  assetDept: string | null | undefined,
  targetsList: Array<string | null | undefined>,
  units: AuditOrgUnit[]
): boolean {
  return targetsList.some((t) => assetInAuditTarget(assetDept, t, units));
}

/** 두 실사 대상범위가 동일·상하위·전사로 겹치는지 */
export function auditTargetsOverlap(
  aTarget: string | null | undefined,
  bTarget: string | null | undefined,
  units: AuditOrgUnit[]
): boolean {
  const ta = parseAuditTargets(aTarget);
  const tb = parseAuditTargets(bTarget);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.includes('전사') || tb.includes('전사')) return true;
  for (const x of ta) {
    for (const y of tb) {
      if (unitCoversAuditTarget(x, y, units) || unitCoversAuditTarget(y, x, units)) {
        return true;
      }
    }
  }
  return false;
}
