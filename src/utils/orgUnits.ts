/**
 * units 목록에서 최상위 조직(Organization) 명칭을 해석합니다.
 * 1) unit_type === 'ORGANIZATION'
 * 2) parent 없는 루트 유닛
 * 없으면 빈 문자열 (호출측에서 전사 풀 매칭 불가 처리)
 */
export function resolveTopOrgName(
  units: Array<{ unit_name?: string | null; unit_type?: string | null; parent_id?: string | null }> | null | undefined
): string {
  if (!Array.isArray(units) || units.length === 0) return '';

  const organizations = units.filter(
    (u) => String(u.unit_type || '').toUpperCase() === 'ORGANIZATION' && u.unit_name
  );
  if (organizations.length === 1) return String(organizations[0].unit_name).trim();
  if (organizations.length > 1) {
    const rootOrg = organizations.find((u) => !u.parent_id);
    if (rootOrg?.unit_name) return String(rootOrg.unit_name).trim();
    return String(organizations[0].unit_name).trim();
  }

  const root = units.find((u) => !u.parent_id && u.unit_name);
  return root?.unit_name ? String(root.unit_name).trim() : '';
}

type OrgUnitLike = {
  id?: string | null;
  unit_name?: string | null;
  parent_id?: string | null;
  parent?: { unit_name?: string | null } | null;
};

/** 직속 하위 조직 명칭 목록 */
export function getChildUnitNames(
  parentName: string | null | undefined,
  parentId: string | null | undefined,
  units: OrgUnitLike[] | null | undefined
): string[] {
  if (!Array.isArray(units) || (!parentName && !parentId)) return [];
  const pName = parentName ? String(parentName).trim() : '';
  const pId = parentId ? String(parentId).trim() : '';
  const names = new Set<string>();
  for (const u of units) {
    if (!u?.unit_name) continue;
    const uidParent = u.parent_id ? String(u.parent_id).trim() : '';
    const byId = !!pId && uidParent === pId;
    const byRelName = !!pName && String(u.parent?.unit_name || '').trim() === pName;
    // parent include 없는 목록(서버 unitsList 등)에서도 parent_id → 이름 해석
    const parentRow =
      !byRelName && !!pName && uidParent
        ? units.find((x) => String(x.id || '').trim() === uidParent)
        : null;
    const byResolvedName =
      !!pName && !!parentRow && String(parentRow.unit_name || '').trim() === pName;
    if (byId || byRelName || byResolvedName) names.add(String(u.unit_name).trim());
  }
  return Array.from(names);
}

/**
 * SupplyItem.owner_dept 파싱
 * - JSON 배열 문자열: '["A","B"]'
 * - 레거시 단일 문자열: '본부A' | '전사'
 * - 배열 그대로 / 콤마 구분
 */
export function parseSupplyOwnerDepts(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))
    );
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((x) => String(x ?? '').trim()).filter(Boolean))
        );
      }
    } catch {
      /* fall through */
    }
  }
  if (s.includes(',')) {
    return Array.from(
      new Set(s.split(',').map((x) => x.trim()).filter(Boolean))
    );
  }
  return [s];
}

/** DB 저장용 — JSON 배열 문자열 */
export function serializeSupplyOwnerDepts(names: string[] | null | undefined): string {
  const uniq = Array.from(
    new Set((names || []).map((n) => String(n ?? '').trim()).filter(Boolean))
  );
  return JSON.stringify(uniq);
}

/**
 * 소모품 inventory 신청 가능 여부 (물품 owner_dept 단건)
 * - 레거시 '전사': 전 조직 신청 가능 (구 데이터)
 * - 그 외: 마케팅 지급 스코프와 동일
 */
export function canRequestSupplyOwnerDept(
  ownerDept: string | null | undefined,
  opts: {
    myUnitName?: string | null;
    myUnitId?: string | null;
    myHqName?: string | null;
    topOrgName?: string | null;
    units?: OrgUnitLike[] | null;
    isPower?: boolean;
  }
): boolean {
  if (opts.isPower) return true;
  const owner = String(ownerDept || '').trim();
  if (!owner) return false;
  if (owner === '전사') return true;
  return canDistributeMarketingOwnerDept(owner, opts);
}

/** 다중 물품소속 — 하나라도 신청 가능하면 true */
export function canRequestSupplyOwnerDepts(
  ownerDeptRaw: unknown,
  opts: Parameters<typeof canRequestSupplyOwnerDept>[1]
): boolean {
  if (opts.isPower) return true;
  const owners = parseSupplyOwnerDepts(ownerDeptRaw);
  if (owners.length === 0) return false;
  return owners.some((o) => canRequestSupplyOwnerDept(o, opts));
}

/**
 * 마케팅 물품 지급(신청) 가능 여부
 *
 * 1) Center: 본인 소속 + 상위 HQ + Organization(최상위)
 * 2) HQ: 본인 소속 + 하위 Center + Organization
 * 3) Organization 소속: Organization 물품만
 * 4) isPower(LV_1만): 전체
 *
 * ※ Organization 물품 CRUD는 canEditMarketingOwnerDept / assertCanEditOwnerDept (global_mgmt) 별도
 */
export function canDistributeMarketingOwnerDept(
  ownerDept: string | null | undefined,
  opts: {
    myUnitName?: string | null;
    myUnitId?: string | null;
    myHqName?: string | null;
    topOrgName?: string | null;
    units?: OrgUnitLike[] | null;
    isPower?: boolean;
  }
): boolean {
  if (opts.isPower) return true;
  if (!ownerDept || !opts.myUnitName) return false;

  const top = (opts.topOrgName || '').trim();
  const me = opts.myUnitName.trim();
  const owner = ownerDept.trim();
  const isTopOrgUser = !!top && me === top;

  // 3) Organization 계정 → 전사 풀만 신청
  if (isTopOrgUser) {
    return owner === top;
  }

  // 본인 소속
  if (owner === me) return true;
  // 1) Center → 상위 HQ
  if (opts.myHqName && owner === opts.myHqName.trim()) return true;
  // 1·2) Organization 풀 신청
  if (top && owner === top) return true;
  // 2) HQ → 하위 Center만 (직속 자식). Organization 사용자는 위에서 return 됨
  const children = getChildUnitNames(opts.myUnitName, opts.myUnitId, opts.units);
  return children.includes(owner);
}

/**
 * SystemConfig.global_mgmt_dept 해석
 * - 신규: OrgUnit.id
 * - 레거시: unit_name (명칭 변경 전 DB 값 호환)
 */
export function resolveGlobalMgmtUnit(
  globalMgmtDept: string | null | undefined,
  units: OrgUnitLike[] | null | undefined
): { id: string; unit_name: string } | null {
  const ref = String(globalMgmtDept || '').trim();
  if (!ref || !Array.isArray(units) || units.length === 0) return null;

  const byId = units.find((u) => String(u.id || '').trim() === ref);
  if (byId?.id) {
    return {
      id: String(byId.id).trim(),
      unit_name: String(byId.unit_name || '').trim(),
    };
  }

  const byName = units.find((u) => String(u.unit_name || '').trim() === ref);
  if (byName?.id) {
    return {
      id: String(byName.id).trim(),
      unit_name: String(byName.unit_name || '').trim(),
    };
  }

  return null;
}

/** owner_dept 등 명칭 비교용 — id/레거시명 → 현재 unit_name */
export function resolveGlobalMgmtDeptName(
  globalMgmtDept: string | null | undefined,
  units: OrgUnitLike[] | null | undefined
): string {
  const resolved = resolveGlobalMgmtUnit(globalMgmtDept, units);
  if (resolved?.unit_name) return resolved.unit_name;
  // units 없이 레거시 명칭만 있는 경우 그대로 반환
  return String(globalMgmtDept || '').trim();
}

/**
 * Organization(최상위) 자산 편집/입고/종료 가능 여부 — global_mgmt_dept만
 * (본인 소속이 topOrg여도 mgmt가 아니면 불가)
 * - 총괄 부서 본인
 * - 총괄이 HQ일 때: 상위 HQ가 총괄인 센터, 또는 총괄의 직속 하위 조직
 */
export function canEditTopOrgMarketingAsset(opts: {
  ownerDept?: string | null;
  topOrgName?: string | null;
  myUnitName?: string | null;
  myHqName?: string | null;
  myUnitId?: string | null;
  globalMgmtDept?: string | null;
  units?: OrgUnitLike[] | null;
}): boolean {
  const top = (opts.topOrgName || '').trim();
  const owner = (opts.ownerDept || '').trim();
  if (!top || owner !== top) return false;
  const mgmt = (opts.globalMgmtDept || '').trim();
  if (!mgmt) return false;
  const me = (opts.myUnitName || '').trim();
  if (!me) return false;

  const myId =
    String(opts.myUnitId || '').trim() ||
    String(
      opts.units?.find((u) => String(u.unit_name || '').trim() === me)?.id || ''
    ).trim();

  return isGlobalMgmtOrgMember({
    myUnitName: me,
    myUnitId: myId || null,
    globalMgmtDept: mgmt,
    units: opts.units,
  });
}

/**
 * admin/settings GLOBAL_MGMT 지정 부서 본인 또는 그 하위 조직(직속 Center 등) 소속인지
 * HQ로 지정하면 하위 Center까지 true (조상 체인이 mgmt에 도달하면 포함)
 * global_mgmt_dept는 OrgUnit.id(권장) 또는 레거시 unit_name
 */
export function isGlobalMgmtOrgMember(opts: {
  myUnitName?: string | null;
  myUnitId?: string | null;
  globalMgmtDept?: string | null;
  units?: OrgUnitLike[] | null;
}): boolean {
  const mgmtRef = String(opts.globalMgmtDept || '').trim();
  const me = String(opts.myUnitName || '').trim();
  if (!mgmtRef) return false;

  // units 없음: 레거시 명칭 직접 비교만 가능
  if (!opts.units?.length) {
    return !!me && me === mgmtRef;
  }

  const units = opts.units;
  const mgmtUnit = resolveGlobalMgmtUnit(mgmtRef, units);
  if (!mgmtUnit) {
    // 해석 실패 시 레거시 명칭 직접 비교
    return !!me && me === mgmtRef;
  }

  const mgmtId = mgmtUnit.id;
  const mgmtName = mgmtUnit.unit_name;

  const myId = String(opts.myUnitId || '').trim();
  let cur =
    (myId ? units.find((u) => String(u.id || '').trim() === myId) : undefined) ||
    (me ? units.find((u) => String(u.unit_name || '').trim() === me) : undefined);

  if (!cur) return false;

  // 본인이 총괄 부서
  if (String(cur.id || '').trim() === mgmtId) return true;
  if (mgmtName && String(cur.unit_name || '').trim() === mgmtName) return true;

  // 직속 하위 (HQ → Center)
  const children = getChildUnitNames(mgmtName || null, mgmtId, units);
  if (me && children.includes(me)) return true;
  const myName = String(cur.unit_name || '').trim();
  if (myName && children.includes(myName)) return true;

  // 조상 체인 상승: Center → HQ(mgmt)
  const seen = new Set<string>();
  while (cur) {
    const cid = cur.id ? String(cur.id).trim() : '';
    if (cid) {
      if (seen.has(cid)) break;
      seen.add(cid);
    }

    const parentId = cur.parent_id ? String(cur.parent_id).trim() : '';
    if (parentId && parentId === mgmtId) return true;

    if (!parentId) break;
    const parent = units.find((u) => String(u.id || '').trim() === parentId);
    if (!parent) break;
    if (String(parent.id || '').trim() === mgmtId) return true;
    if (mgmtName && String(parent.unit_name || '').trim() === mgmtName) return true;
    cur = parent;
  }
  return false;
}

/**
 * 타부서 열람 LV로 지정된 인원에게 신청을 열어둔 물품인지
 * (view_role_ids 미지정=전원 열람만 → 신청 개방 안 함)
 */
export function canApplyViaViewRoles(
  item: { view_role_ids?: unknown; view_allow_apply?: boolean | null },
  userRoles: unknown
): boolean {
  if (!item?.view_allow_apply) return false;
  const raw = item.view_role_ids;
  if (!raw) return false;
  const arr = Array.isArray(raw) ? raw : [raw];
  const required = Array.from(
    new Set(
      arr
        .map((r) => {
          const m = String(r ?? '').trim().match(/(\d+)/);
          return m ? `LV_${m[1]}` : '';
        })
        .filter(Boolean)
    )
  );
  if (required.length === 0) return false;
  const rolesArr = !userRoles ? [] : Array.isArray(userRoles) ? userRoles : [userRoles];
  const mine = rolesArr.map((r) => {
    const m = String(r ?? '').trim().match(/(\d+)/);
    return m ? `LV_${m[1]}` : String(r);
  });
  return mine.some((r) => required.includes(r));
}
