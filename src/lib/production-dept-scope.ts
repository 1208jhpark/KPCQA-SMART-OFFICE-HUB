/**
 * 제작물 부서 스코프 — OrgUnit.id 우선, unitId 없는 레거시만 deptName 폴백.
 * admin/units 에서 조직명만 바꿔도 id가 같으면 필터·권한이 따라갑니다.
 */

import prisma from '@/lib/prisma';

export type ProductionScopeUnit = { id: string; unit_name: string };

export type ProductionDeptScope = {
  myUnit: ProductionScopeUnit;
  scopeUnits: ProductionScopeUnit[];
  scopeNames: string[];
  viewScope: string;
};

export type ProductionDeptRowRef = {
  unitId?: string | null;
  deptName?: string | null;
};

/** Prisma where: 스코프 내 제작 신청 (unitId 우선) */
export function buildProductionDeptScopeWhere(
  scope: ProductionDeptScope
): Record<string, unknown> | null {
  if (scope.viewScope === 'NONE') return null;
  const scopeIds = scope.scopeUnits.map((u) => u.id).filter(Boolean);
  if (scopeIds.length === 0 && scope.scopeNames.length === 0) return null;

  const orClauses: Record<string, unknown>[] = [];
  if (scopeIds.length > 0) {
    orClauses.push({ unitId: { in: scopeIds } });
  }
  if (scope.scopeNames.length > 0) {
    orClauses.push({
      AND: [{ unitId: null }, { deptName: { in: scope.scopeNames } }],
    });
  }
  if (orClauses.length === 0) return null;
  return { OR: orClauses };
}

export function assertProductionRowInDeptScope(
  scope: ProductionDeptScope | null | undefined,
  row: ProductionDeptRowRef
): boolean {
  if (!scope || scope.viewScope === 'NONE') return false;
  const scopeIds = new Set(scope.scopeUnits.map((u) => u.id).filter(Boolean));
  const unitId = String(row.unitId || '').trim();
  if (unitId) return scopeIds.has(unitId);
  if (scopeIds.size === 0 && scope.scopeNames.length === 0) return false;
  return scope.scopeNames.includes(String(row.deptName || '').trim());
}

export function isProductionScopeEmpty(scope: ProductionDeptScope | null | undefined): boolean {
  if (!scope || scope.viewScope === 'NONE') return true;
  return scope.scopeUnits.length === 0 && scope.scopeNames.length === 0;
}

/** 표시용: 현재 OrgUnit 명칭 우선 (개명 반영), 없으면 신청 스냅샷 */
export function overlayProductionDeptDisplay<
  T extends { unitId?: string | null; deptName?: string | null; deptHead?: string | null },
>(
  rows: T[],
  unitById: Map<string, { unit_name: string; parent_name?: string | null }>
): T[] {
  return rows.map((r) => {
    const id = String(r.unitId || '').trim();
    if (!id) return r;
    const u = unitById.get(id);
    if (!u) return r;
    return {
      ...r,
      deptName: u.unit_name || r.deptName,
      deptHead: u.parent_name || r.deptHead,
    };
  });
}

export async function loadProductionUnitDisplayMap(
  unitIds: Array<string | null | undefined>
): Promise<Map<string, { unit_name: string; parent_name?: string | null }>> {
  const ids = [...new Set(unitIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const map = new Map<string, { unit_name: string; parent_name?: string | null }>();
  if (ids.length === 0) return map;
  const rows = await prisma.orgUnit.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      unit_name: true,
      parent: { select: { unit_name: true } },
    },
  });
  for (const r of rows) {
    map.set(r.id, {
      unit_name: r.unit_name,
      parent_name: r.parent?.unit_name ?? null,
    });
  }
  return map;
}

export async function withProductionDeptDisplayNames<
  T extends { unitId?: string | null; deptName?: string | null; deptHead?: string | null },
>(rows: T[]): Promise<T[]> {
  const map = await loadProductionUnitDisplayMap(rows.map((r) => r.unitId));
  return overlayProductionDeptDisplay(rows, map);
}
