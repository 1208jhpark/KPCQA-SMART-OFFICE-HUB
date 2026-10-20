import {
  LEGACY_DUTY_LABEL_TO_CODE,
  normalizeDutyCode,
  resolveDutyCode,
  type UserJobOption,
} from '@/lib/user-job-options';

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

/** 직속 하위 조직 id 목록 */
export function getChildUnitIds(
  parentId: string | null | undefined,
  units: OrgUnitLike[] | null | undefined
): string[] {
  if (!Array.isArray(units) || !parentId) return [];
  const pId = String(parentId).trim();
  if (!pId) return [];
  return units
    .filter((u) => String(u.parent_id || '').trim() === pId && u.id)
    .map((u) => String(u.id).trim())
    .filter(Boolean);
}

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

/** SupplyItem.owner_unit_ids JSON 파싱 */
export function parseSupplyOwnerUnitIds(raw: unknown): string[] {
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
  return [];
}

/** 명칭 배열 → OrgUnit id 배열 (매칭되는 것만) */
export function resolveOwnerUnitIdsFromNames(
  names: string[] | null | undefined,
  units: OrgUnitLike[] | null | undefined
): string[] {
  if (!Array.isArray(names) || !Array.isArray(units)) return [];
  const ids: string[] = [];
  for (const n of names) {
    const name = String(n || '').trim();
    if (!name || name === '전사') continue;
    const u = units.find((x) => String(x.unit_name || '').trim() === name);
    const id = String(u?.id || '').trim();
    if (id) ids.push(id);
  }
  return Array.from(new Set(ids));
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
    ownerUnitId?: string | null;
  }
): boolean {
  if (opts.isPower) return true;
  const owner = String(ownerDept || '').trim();
  if (owner === '전사') return true;
  return canDistributeMarketingOwnerDept(owner, {
    ...opts,
    ownerUnitId: opts.ownerUnitId,
  });
}

/** 다중 물품소속 — owner_unit_ids 우선, 없으면 명칭 로직 */
export function canRequestSupplyOwnerDepts(
  ownerDeptRaw: unknown,
  opts: Parameters<typeof canRequestSupplyOwnerDept>[1] & {
    ownerUnitIds?: unknown;
  }
): boolean {
  if (opts.isPower) return true;
  const unitIds = parseSupplyOwnerUnitIds(opts.ownerUnitIds);
  if (unitIds.length > 0) {
    return unitIds.some((id) =>
      canRequestSupplyOwnerDept(null, { ...opts, ownerUnitId: id })
    );
  }
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
 * ownerUnitId 있으면 id 우선, 없으면 owner_dept 명칭 폴백.
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
    ownerUnitId?: string | null;
    /** true면 Organization(전사) 풀 자동개방 제외 — view_role_ids 게이트용 */
    excludeTopOrgPool?: boolean;
  }
): boolean {
  if (opts.isPower) return true;

  const ownerId = String(opts.ownerUnitId || '').trim();
  const myId = String(opts.myUnitId || '').trim();
  const top = (opts.topOrgName || '').trim();
  const me = String(opts.myUnitName || '').trim();
  const units = opts.units;
  const skipTopPool = !!opts.excludeTopOrgPool;

  // id 경로: owner_unit_id 있는 행
  if (ownerId) {
    if (!myId && !me) return false;
    const topId = top
      ? String(units?.find((u) => String(u.unit_name || '').trim() === top)?.id || '').trim()
      : '';
    const isTopOrgUser =
      (!!topId && !!myId && myId === topId) || (!!top && !!me && me === top);

    if (isTopOrgUser) {
      return !!topId && ownerId === topId;
    }

    if (myId && ownerId === myId) return true;

    // Center → 상위 HQ id
    if (myId && units?.length) {
      const myRow = units.find((u) => String(u.id || '').trim() === myId);
      const parentId = String(myRow?.parent_id || '').trim();
      if (parentId && ownerId === parentId) return true;
    } else if (opts.myHqName && units?.length) {
      const hqId = String(
        units.find((u) => String(u.unit_name || '').trim() === String(opts.myHqName).trim())?.id ||
          ''
      ).trim();
      if (hqId && ownerId === hqId) return true;
    }

    if (!skipTopPool && topId && ownerId === topId) return true;

    const childIds = getChildUnitIds(myId || null, units);
    return childIds.includes(ownerId);
  }

  // 레거시 명칭 폴백
  if (!ownerDept || !me) return false;
  const owner = ownerDept.trim();
  const isTopOrgUser = !!top && me === top;

  if (isTopOrgUser) {
    return owner === top;
  }

  if (owner === me) return true;
  if (opts.myHqName && owner === opts.myHqName.trim()) return true;
  if (!skipTopPool && top && owner === top) return true;
  const children = getChildUnitNames(opts.myUnitName, opts.myUnitId, opts.units);
  return children.includes(owner);
}

/** 전사(Organization) 소유 물품인지 */
export function isMarketingTopOrgItem(
  item: { owner_dept?: string | null; owner_unit_id?: string | null },
  topOrgName?: string | null,
  units?: OrgUnitLike[] | null
): boolean {
  const top = String(topOrgName || '').trim();
  if (!top) return false;
  const owner = String(item.owner_dept || '').trim();
  if (owner && owner === top) return true;
  const ownerId = String(item.owner_unit_id || '').trim();
  if (!ownerId || !units?.length) return false;
  const topId = String(units.find((u) => String(u.unit_name || '').trim() === top)?.id || '').trim();
  return !!topId && ownerId === topId;
}

/**
 * 지급 신청·카탈로그 카드 노출용 최종 판정
 * - 본인 소속/본부/하위: 구조적 즉시 신청
 * - view_role_ids 지정 물품(센터·본부·전사 소유 무관): 타부서 LV·직책 공유 신청
 * - 레거시 전사(Organization) 소유: GLOBAL_MGMT는 전체, 그 외는 view_role 필수
 */
export function canApplyMarketingItem(
  item: {
    owner_dept?: string | null;
    owner_unit_id?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  },
  opts: {
    myUnitName?: string | null;
    myUnitId?: string | null;
    myHqName?: string | null;
    topOrgName?: string | null;
    units?: OrgUnitLike[] | null;
    isPower?: boolean;
    userRoles?: unknown;
    userDuty?: string | null;
    dutyCode?: string | null;
    dutyOptions?: UserJobOption[] | null;
    globalMgmtDept?: string | null;
  }
): boolean {
  if (opts.isPower) return true;

  if (
    canDistributeMarketingOwnerDept(item.owner_dept, {
      myUnitName: opts.myUnitName,
      myUnitId: opts.myUnitId,
      myHqName: opts.myHqName,
      topOrgName: opts.topOrgName,
      units: opts.units,
      isPower: false,
      ownerUnitId: item.owner_unit_id,
      excludeTopOrgPool: true,
    })
  ) {
    return true;
  }

  const viewOpts = {
    dutyCode: opts.dutyCode,
    dutyOptions: opts.dutyOptions,
  };

  if (isMarketingTopOrgItem(item, opts.topOrgName, opts.units)) {
    // 레거시 전사 소유: GLOBAL_MGMT 전체 개방
    if (
      isGlobalMgmtOrgMember({
        myUnitName: opts.myUnitName,
        myUnitId: opts.myUnitId,
        globalMgmtDept: opts.globalMgmtDept,
        units: opts.units,
      })
    ) {
      return true;
    }
    const tokens = parseViewAllowTokens(item.view_role_ids);
    if (tokens.length === 0) return false;
    return canApplyViaViewRoles(item, opts.userRoles, opts.userDuty, viewOpts);
  }

  // 센터/본부 소유 + view_role 공유 → 타부서 신청가능
  return canApplyViaViewRoles(item, opts.userRoles, opts.userDuty, viewOpts);
}

/**
 * 「전사 · 신청가능」풀: 구조적 소속이 아닌 view_role 공유로만 신청 가능한 물품
 */
export function isSharedMarketingApplyItem(
  item: {
    owner_dept?: string | null;
    owner_unit_id?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  },
  opts: {
    myUnitName?: string | null;
    myUnitId?: string | null;
    myHqName?: string | null;
    topOrgName?: string | null;
    units?: OrgUnitLike[] | null;
    isPower?: boolean;
    userRoles?: unknown;
    userDuty?: string | null;
    dutyCode?: string | null;
    dutyOptions?: UserJobOption[] | null;
    globalMgmtDept?: string | null;
  }
): boolean {
  if (!canApplyMarketingItem(item, opts)) return false;
  if (opts.isPower) {
    // LV_1: 구조적 범위 밖 + view_role 있는 물품만 공유 탭에
    const structural = canDistributeMarketingOwnerDept(item.owner_dept, {
      myUnitName: opts.myUnitName,
      myUnitId: opts.myUnitId,
      myHqName: opts.myHqName,
      topOrgName: opts.topOrgName,
      units: opts.units,
      isPower: false,
      ownerUnitId: item.owner_unit_id,
      excludeTopOrgPool: true,
    });
    if (structural) return false;
    return parseViewAllowTokens(item.view_role_ids).length > 0 ||
      isMarketingTopOrgItem(item, opts.topOrgName, opts.units);
  }
  const structural = canDistributeMarketingOwnerDept(item.owner_dept, {
    myUnitName: opts.myUnitName,
    myUnitId: opts.myUnitId,
    myHqName: opts.myHqName,
    topOrgName: opts.topOrgName,
    units: opts.units,
    isPower: false,
    ownerUnitId: item.owner_unit_id,
    excludeTopOrgPool: true,
  });
  return !structural;
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

    //const parentId = cur.parent_id ? String(cur.parent_id).trim() : '';
    const parentId: string = cur.parent_id ? String(cur.parent_id).trim() : '';
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

/** @deprecated 레거시 한글 라벨 — 신규는 DUTY_* 코드 사용 */
export const MARKETING_LV2_DUTY_LABELS = [
  '원장',
  '부원장',
  '상무',
  '본부장',
  '센터장',
] as const;

const MARKETING_VIEW_LV_SET = new Set(['LV_1', 'LV_2', 'LV_3']);
const MARKETING_LV2_DUTY_LABEL_SET = new Set<string>(MARKETING_LV2_DUTY_LABELS);

/** view_role_ids 토큰 정규화: LV_n / DUTY_* / 레거시 직책 한글 */
export function normalizeViewAllowToken(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const lv = s.match(/^LV[_\s-]?(\d+)$/i);
  if (lv) return `LV_${lv[1]}`;
  if (/^\d+$/.test(s)) return `LV_${s}`;
  const asDuty = normalizeDutyCode(s);
  if (asDuty.startsWith('DUTY_')) return asDuty;
  const legacy = LEGACY_DUTY_LABEL_TO_CODE[s];
  if (legacy) return legacy;
  return s;
}

/** 저장·판정용 허용 토큰 (LV_1~3 + DUTY_* + 레거시 한글) */
export function parseViewAllowTokens(raw: unknown): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const r of arr) {
    const t = normalizeViewAllowToken(r);
    if (!t) continue;
    if (
      MARKETING_VIEW_LV_SET.has(t) ||
      t.startsWith('DUTY_') ||
      MARKETING_LV2_DUTY_LABEL_SET.has(t)
    ) {
      out.push(t);
    }
  }
  return Array.from(new Set(out));
}

/**
 * 타부서 열람·신청 허용 대상인지
 * - LV_1 / LV_2 / LV_3: roles 매칭
 * - 「전사 허용」: LV_1·2·3 전원
 * - 직책: User.duty → duty_code(DUTY_*) 매칭 (레거시 한글 view_role도 허용)
 */
export function canApplyViaViewRoles(
  item: { view_role_ids?: unknown; view_allow_apply?: boolean | null },
  userRoles: unknown,
  userDuty?: string | null,
  opts?: {
    dutyCode?: string | null;
    dutyOptions?: UserJobOption[] | null;
  }
): boolean {
  const required = parseViewAllowTokens(item?.view_role_ids);
  if (required.length === 0) return false;

  const rolesArr = !userRoles ? [] : Array.isArray(userRoles) ? userRoles : [userRoles];
  const mine = rolesArr.map((r) => normalizeViewAllowToken(r)).filter(Boolean);
  if (mine.some((r) => required.includes(r))) return true;

  const companyWide =
    required.includes('LV_3') ||
    (required.includes('LV_1') && required.includes('LV_2') && required.includes('LV_3'));
  if (companyWide && mine.some((r) => r === 'LV_1' || r === 'LV_2' || r === 'LV_3')) {
    return true;
  }

  if (required.includes('LV_2') && mine.includes('LV_2')) return true;

  const dutyLabel = String(userDuty || '').trim();
  const dutyCode =
    String(opts?.dutyCode || '').trim() ||
    resolveDutyCode(dutyLabel || opts?.dutyCode, opts?.dutyOptions);

  if (dutyCode && required.includes(dutyCode)) return true;
  // 레거시: view_role에 한글 직책이 남아 있는 경우
  if (dutyLabel && required.includes(dutyLabel)) return true;
  if (dutyLabel) {
    const mapped = LEGACY_DUTY_LABEL_TO_CODE[dutyLabel];
    if (mapped && required.includes(mapped)) return true;
  }

  return false;
}
