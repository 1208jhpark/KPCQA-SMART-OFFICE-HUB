/**
 * 조직 id 기준 매칭 — admin/units 명칭 변경에도 스코프·필터가 따라가도록.
 * 클라이언트/서버 공용 (prisma 없음).
 */

export type OrgUnitNode = {
  id: string;
  unit_name?: string | null;
  parent_id?: string | null;
};

/** 선택 조직 + 하위 전체 id */
export function collectDescendantUnitIds(
  rootId: string,
  units: OrgUnitNode[] | null | undefined
): Set<string> {
  const ids = new Set<string>();
  const root = String(rootId || '').trim();
  if (!root || !Array.isArray(units)) return ids;
  ids.add(root);
  const walk = (parentId: string) => {
    for (const u of units) {
      if (String(u.parent_id || '').trim() === parentId) {
        const id = String(u.id || '').trim();
        if (id && !ids.has(id)) {
          ids.add(id);
          walk(id);
        }
      }
    }
  };
  walk(root);
  return ids;
}

/** 선택 조직 + 하위 전체 명칭 (레거시 폴백용) */
export function collectDescendantUnitNames(
  rootId: string,
  units: OrgUnitNode[] | null | undefined
): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(units)) return names;
  for (const id of collectDescendantUnitIds(rootId, units)) {
    const u = units.find((x) => x.id === id);
    const n = String(u?.unit_name || '').trim();
    if (n) names.add(n);
  }
  return names;
}

/**
 * 행이 선택 조직(및 하위)에 속하는지.
 * unitId 우선, 없으면 레거시 명칭(deptName/deptHead 등) 폴백.
 */
export function rowMatchesOrgUnit(opts: {
  selectedOrgId: string;
  units: OrgUnitNode[] | null | undefined;
  unitId?: string | null;
  legacyNames?: Array<string | null | undefined>;
}): boolean {
  const selected = String(opts.selectedOrgId || '').trim();
  if (!selected || selected === 'ALL') return true;
  const uid = String(opts.unitId || '').trim();
  if (uid) return collectDescendantUnitIds(selected, opts.units).has(uid);
  const names = collectDescendantUnitNames(selected, opts.units);
  for (const raw of opts.legacyNames || []) {
    const n = String(raw || '').trim();
    if (n && names.has(n)) return true;
  }
  return false;
}

/** Prisma OR: unitId in scopeIds OR (unitId null AND nameField in scopeNames) */
export function buildUnitIdOrLegacyNameWhere(opts: {
  unitIdField: string;
  nameField: string;
  scopeIds: string[];
  scopeNames: string[];
}): Record<string, unknown> | null {
  const scopeIds = (opts.scopeIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  const scopeNames = (opts.scopeNames || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (scopeIds.length === 0 && scopeNames.length === 0) return null;
  const or: Record<string, unknown>[] = [];
  if (scopeIds.length > 0) {
    or.push({ [opts.unitIdField]: { in: scopeIds } });
  }
  if (scopeNames.length > 0) {
    or.push({
      AND: [{ [opts.unitIdField]: null }, { [opts.nameField]: { in: scopeNames } }],
    });
  }
  return or.length ? { OR: or } : null;
}
