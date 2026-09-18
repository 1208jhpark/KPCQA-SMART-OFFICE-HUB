/**
 * IT 실사 대상범위(target) ↔ 자산/사용자 부서 매칭
 * - target: 콤마 구분 조직명, '전사'면 전체 (표시용)
 * - target_unit_ids: OrgUnit.id JSON 배열 — 명칭 변경에도 대상 유지
 */

import {
  collectDescendantUnitIds,
  collectDescendantUnitNames,
} from '@/lib/org-unit-match';

export type AuditOrgUnit = {
  id?: string | null;
  unit_name?: string | null;
  parent_id?: string | null;
};

function asOrgNodes(units: AuditOrgUnit[]) {
  return units as Array<{ id: string; unit_name?: string | null; parent_id?: string | null }>;
}

export type AuditAssetRef = {
  dept?: string | null;
  unit_id?: string | null;
};

export function parseAuditTargets(target: string | null | undefined): string[] {
  return String(target || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** target_unit_ids JSON / 배열 / 단일 문자열 → id 목록 */
export function parseAuditTargetUnitIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x || '').trim()).filter(Boolean);
        }
      } catch {
        /* fall through */
      }
    }
    return s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/** A가 B의 상위(또는 동일) 조직인지 (명칭) */
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

function normalizeAssetRef(
  assetDeptOrRow: string | null | undefined | AuditAssetRef
): AuditAssetRef {
  if (assetDeptOrRow && typeof assetDeptOrRow === 'object') {
    return {
      dept: assetDeptOrRow.dept,
      unit_id: assetDeptOrRow.unit_id,
    };
  }
  return { dept: assetDeptOrRow as string | null | undefined, unit_id: null };
}

/** unit_id가 대상 id(+하위)에 포함되는지 */
function unitIdInTargetIds(
  unitId: string,
  targetIds: string[],
  units: AuditOrgUnit[]
): boolean {
  if (!unitId || targetIds.length === 0) return false;
  for (const tid of targetIds) {
    if (collectDescendantUnitIds(tid, asOrgNodes(units)).has(unitId)) return true;
  }
  return false;
}

/** 레거시 명칭이 대상 id(+하위) 명칭에 포함되는지 */
function legacyNameInTargetIds(
  deptName: string,
  targetIds: string[],
  units: AuditOrgUnit[]
): boolean {
  if (!deptName || targetIds.length === 0) return false;
  for (const tid of targetIds) {
    if (collectDescendantUnitNames(tid, asOrgNodes(units)).has(deptName)) return true;
  }
  return false;
}

/**
 * 자산 부서가 해당 실사 target에 포함되는지.
 * 1) target_unit_ids 우선 (자산 unit_id → 없으면 dept 명칭 폴백)
 * 2) 없으면 target 명칭 CSV (레거시)
 */
export function assetInAuditTarget(
  assetDeptOrRow: string | null | undefined | AuditAssetRef,
  target: string | null | undefined,
  units: AuditOrgUnit[],
  targetUnitIds?: unknown
): boolean {
  const row = normalizeAssetRef(assetDeptOrRow);
  const dept = String(row.dept || '').trim();
  const unitId = String(row.unit_id || '').trim();
  const ids = parseAuditTargetUnitIds(targetUnitIds);
  const targets = parseAuditTargets(target);

  if (targets.includes('전사')) return true;
  if (ids.length === 0 && targets.length === 0) return false;

  if (ids.length > 0) {
    if (unitId) return unitIdInTargetIds(unitId, ids, units);
    if (dept) return legacyNameInTargetIds(dept, ids, units);
    return false;
  }

  if (!dept) return false;
  return targets.some((t) => unitCoversAuditTarget(t, dept, units));
}

/** 여러 실사 target 중 하나라도 포함되면 true */
export function assetInAnyAuditTarget(
  assetDeptOrRow: string | null | undefined | AuditAssetRef,
  targetsList: Array<string | null | undefined>,
  units: AuditOrgUnit[],
  targetUnitIdsList?: unknown[]
): boolean {
  return targetsList.some((t, i) =>
    assetInAuditTarget(assetDeptOrRow, t, units, targetUnitIdsList?.[i])
  );
}

/**
 * 사용자 unit_id가 실사 대상(id+하위)에 포함되는지.
 * unit_id 없으면 레거시 dept 명칭 폴백.
 */
export function userMatchesAuditTarget(opts: {
  userUnitId?: string | null;
  userDeptName?: string | null;
  target?: string | null;
  targetUnitIds?: unknown;
  units: AuditOrgUnit[];
}): boolean {
  return assetInAuditTarget(
    { dept: opts.userDeptName, unit_id: opts.userUnitId },
    opts.target,
    opts.units,
    opts.targetUnitIds
  );
}

/** 두 실사 대상범위가 동일·상하위·전사로 겹치는지 (id 우선) */
export function auditTargetsOverlap(
  aTarget: string | null | undefined,
  bTarget: string | null | undefined,
  units: AuditOrgUnit[],
  aUnitIds?: unknown,
  bUnitIds?: unknown
): boolean {
  const ta = parseAuditTargets(aTarget);
  const tb = parseAuditTargets(bTarget);
  const aIds = parseAuditTargetUnitIds(aUnitIds);
  const bIds = parseAuditTargetUnitIds(bUnitIds);

  if (ta.includes('전사') || tb.includes('전사')) return true;

  if (aIds.length > 0 && bIds.length > 0) {
    for (const x of aIds) {
      const xSet = collectDescendantUnitIds(x, asOrgNodes(units));
      for (const y of bIds) {
        const ySet = collectDescendantUnitIds(y, asOrgNodes(units));
        for (const id of xSet) {
          if (ySet.has(id)) return true;
        }
      }
    }
    return false;
  }

  if (ta.length === 0 || tb.length === 0) return false;
  for (const x of ta) {
    for (const y of tb) {
      if (unitCoversAuditTarget(x, y, units) || unitCoversAuditTarget(y, x, units)) {
        return true;
      }
    }
  }
  return false;
}
