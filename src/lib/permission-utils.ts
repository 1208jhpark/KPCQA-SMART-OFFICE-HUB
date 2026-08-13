// JSON 파싱 안전 헬퍼
const safeArray = (val: any) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return val.split(',').map((s: string) => s.trim().replace(/['"\[\]]/g, ''));
      }
    }
    return [val];
  };

export type PermissionScope = 'TOTAL' | 'DEPT' | 'OWN' | 'NONE';

export function pickWidestPermissionScope(scopes: string[]): PermissionScope {
  if (scopes.includes('TOTAL')) return 'TOTAL';
  if (scopes.includes('DEPT')) return 'DEPT';
  if (scopes.includes('OWN')) return 'OWN';
  return 'NONE';
}

export function normalizePermissionScopes(raw: any): string[] {
  return safeArray(raw)
    .map((s: any) => String(s).toUpperCase())
    .map((s: string) => (s === 'GLOBAL' ? 'TOTAL' : s))
    .filter((s: string) => ['OWN', 'DEPT', 'TOTAL'].includes(s));
}

/** Master 지정 여부 (id 문자열 정규화 비교) */
export function isMenuMasterUser(userId: any, menu: any): boolean {
  const masterId = String(menu?.master_editor_id || '').trim();
  const uid = String(userId || '').trim();
  return !!masterId && !!uid && masterId === uid;
}

/**
 * 하위(자손) interface 카드 중 Master로 지정된 메뉴가 있는지.
 * Step3 사이드바는 L3 권한만 보므로, L4 Master만 있어도 조상 L3/L2가 보여야 함.
 */
export function isMasterOfDescendantMenu(
  userId: any,
  menu: any,
  allMenus: any[] = []
): boolean {
  const uid = String(userId || '').trim();
  if (!uid || !menu?.id || !Array.isArray(allMenus) || allMenus.length === 0) return false;

  const byParent = new Map<string, any[]>();
  for (const m of allMenus) {
    const pid = m?.parent_id;
    if (pid == null) continue;
    const key = String(pid);
    const list = byParent.get(key);
    if (list) list.push(m);
    else byParent.set(key, [m]);
  }

  const stack = [...(byParent.get(String(menu.id)) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (isMenuMasterUser(uid, cur)) return true;
    const kids = byParent.get(String(cur.id));
    if (kids?.length) stack.push(...kids);
  }
  return false;
}

/**
 * FE/API 공통 편집 자격·스코프 (checkMenuPermission Edit 관문과 동일).
 * - edit_scopes 비움/CODED만 = NONE (TOTAL로 취급 금지)
 * - Task Editor: 규칙 ∪ 개인 scope → 더 넓은 쪽
 * - hasAccess 기본 true (페이지 진입 후 FE). API는 hasAccessPassed를 넘김
 */
export function resolveInterfaceEditState(
  user: any,
  menu: any,
  options?: { hasAccess?: boolean }
): { isEditor: boolean; editScope: PermissionScope; isMaster: boolean } {
  const deny = { isEditor: false, editScope: 'NONE' as const, isMaster: false };
  if (!user) return deny;

  const myId = user.id || user.userId || user._id;
  const myEmailNorm = String(user.email || '').trim().toLowerCase();
  const rolesArr = safeArray(user.roles);
  const firstRole = rolesArr[0] || user.role || user.level || 'LV_3';
  const levelMatch = String(firstRole).match(/\d+/);
  const myRole = levelMatch ? `LV_${levelMatch[0]}` : 'LV_3';
  const isLv1 =
    myRole === 'LV_1' ||
    rolesArr.some((r: any) => {
      const m = String(r).match(/\d+/);
      return m ? `LV_${m[0]}` === 'LV_1' : false;
    });

  if (isLv1) {
    return { isEditor: true, editScope: 'TOTAL', isMaster: true };
  }
  if (!menu) return deny;

  if (menu.master_editor_id === myId || String(menu.master_editor_id || '') === String(myId || '')) {
    return { isEditor: true, editScope: 'TOTAL', isMaster: true };
  }

  const hasAccess = options?.hasAccess ?? true;
  const pEditScopes = safeArray(menu.edit_scopes);
  const pTMasters = safeArray(menu.task_masters);
  const pERoles = safeArray(menu.edit_role_ids);

  const isTaskEditor = pTMasters.some(
    (tm: any) => String(tm?.email || '').trim().toLowerCase() === myEmailNorm
  );
  const normalizedEditRoles = pERoles.map((r: any) => {
    const m = String(r).match(/\d+/);
    return m ? `LV_${m[0]}` : String(r);
  });
  const editLevelPassed =
    normalizedEditRoles.length > 0 && normalizedEditRoles.includes(myRole);
  const isEditorPassed = hasAccess && (isTaskEditor || editLevelPassed);

  const validEditScopes = normalizePermissionScopes(pEditScopes);
  let personalEditScope: string | null = null;
  if (isTaskEditor) {
    const tm = pTMasters.find(
      (t: any) => String(t?.email || '').trim().toLowerCase() === myEmailNorm
    );
    const tmScope = String(tm?.scope || '').toUpperCase();
    if (tmScope === 'GLOBAL' || tmScope === 'TOTAL') personalEditScope = 'TOTAL';
    else if (tmScope === 'DEPT') personalEditScope = 'DEPT';
    else if (tmScope === 'OWN') personalEditScope = 'OWN';
    else personalEditScope = 'DEPT';
  }

  let editScope: PermissionScope = 'NONE';
  if (isEditorPassed) {
    const combined: string[] = [...validEditScopes];
    if (personalEditScope) combined.push(personalEditScope);
    editScope = combined.length > 0 ? pickWidestPermissionScope(combined) : 'NONE';
  }

  return {
    isEditor: isEditorPassed && editScope !== 'NONE',
    editScope,
    isMaster: false,
  };
}
  
  // 1. Org Guard: 본인 org_ids 우선, 없으면 상위 상속(레거시). 최종 비면 접근 불허
  export const getEffectiveAllowedOrgs = (menu: any, allMenus: any[]) => {
    let curr = menu;
    while (curr) {
      const orgs = safeArray(curr.org_ids).filter(Boolean);
      if (orgs.length > 0) return orgs;
      curr = allMenus.find((m: any) => m.id === curr.parent_id);
    }
    return []; // 제약이 하나도 걸려있지 않으면 빈 배열 반환
  };
  
  // 2. 부서 계층 구조상 허용된 부서인지 확인하는 함수 (Org Guard 검증)
  export const isOrgAllowed = (effectiveOrgIds: string[], userDeptId: string, unitsList: any[] = []) => {
    // Org 미지정(빈 배열) = 접근 불허. 'ALL'만 전부서 허용
    if (!effectiveOrgIds || effectiveOrgIds.length === 0) {
      return false;
    }
    if (effectiveOrgIds.includes('ALL')) {
      return true;
    }
    if (!userDeptId) return false;
    
    let currentId: string | null = userDeptId;
    // 내 부서부터 최상위 본부까지 거슬러 올라가며 허용 목록에 있는지 검사
    while (currentId) {
      if (effectiveOrgIds.includes(currentId)) return true;
      const parentOrg = unitsList.find((u: any) => u.id === currentId);
      currentId = parentOrg ? parentOrg.parent_id : null;
    }
    return false;
  };
  
  // 3. 🚀 최종 권한 판별 메인 엔진 (LV_3 포맷 인식 오류 수정본)
  export const checkMenuPermission = (user: any, menu: any, allMenus: any[], unitsList: any[] = []) => {
    // 기본 상태 (접근 불가)
    const defaultDeny = { 
      hasAccess: false, 
      isMaster: false, 
      isEditor: false, 
      isViewer: false, 
      viewScope: 'NONE', 
      editScope: 'NONE', 
      myRole: 'GUEST',
      isTaskAccess: false,
    };
    
    if (!user) return defaultDeny;

    const myId = user.id || user.userId || user._id;
    const myEmail = user.email;
    const myDept = user.dept_id || user.unit_id || user.unit?.id;
  
    // 🚀 [치명적 버그 픽스]: 하이픈(-), 소문자, 공백 등 어떤 규격이 들어와도 "LV_숫자" 형태로 강제 통일
    const rolesArr = safeArray(user.roles);
    const firstRole = rolesArr[0] || user.role || user.level || 'LV_3';
    const levelMatch = String(firstRole).match(/\d+/);
    const myRole = levelMatch ? `LV_${levelMatch[0]}` : 'LV_3';
    const isLv1 =
      myRole === 'LV_1' ||
      rolesArr.some((r: any) => {
        const m = String(r).match(/\d+/);
        return m ? `LV_${m[0]}` === 'LV_1' : false;
      });
  
    // 👑 LV_1은 메뉴 미등록(interfaceConfig null)이어도 프리패스 — 미지정 장비 정리 등
    if (isLv1) {
      return { 
        hasAccess: true, 
        isMaster: true,
        isEditor: true, 
        isViewer: true,
        viewScope: 'TOTAL',
        editScope: 'TOTAL',
        myRole: 'LV_1',
        isTaskAccess: false,
      };
    }

    if (!menu) return defaultDeny;

    // 👑 [MASTER 지정] — 이 카드(또는 하위 L4 등)에 한해 LV_1과 동일
    // Access Org/Level·Edit보다 우선. L4만 Master여도 조상 L3/L2 사이드바·진입 가능.
    const isMaster =
      isMenuMasterUser(myId, menu) ||
      isMasterOfDescendantMenu(myId, menu, allMenus);
    if (isMaster) {
      return { 
        hasAccess: true, 
        isMaster: true,
        isEditor: true, 
        isViewer: true,
        viewScope: 'TOTAL',
        editScope: 'TOTAL',
        myRole, // 실제 역할 유지 (전역 LV_1 아님). 권한 판별은 isMaster로.
        isTaskAccess: false,
      };
    }
  
    // 데이터베이스 설정값 안전 추출
    const pVScopes = safeArray(menu.view_scopes);      // [결과] 보이는 화면 (View Scope)
    const pTAccess = safeArray(menu.task_accesses);    // 1️⃣ [예외] Task Access 명단
    const pVRoles = safeArray(menu.view_role_ids);     // 3️⃣ [규칙] 접근 권한 레벨
  
    const myEmailNorm = String(myEmail || '').trim().toLowerCase();

    // ---------------------------------------------------------
    // 👁️ [접근 권한(ACCESS) 관문]
    // 규칙: Org ∧ Level → 진입
    // 예외: Task Access는 Org·Level만 우회 (View Scope는 예외 아님)
    // 결과: 진입자 전원(예외 포함)이 동일 view_scopes를 따름
    // ---------------------------------------------------------
    // 1️⃣ [예외] Task Access — 규칙 1·2만 우회
    const isTaskAccess = pTAccess.some(
      (ta: any) => String(ta?.email || '').trim().toLowerCase() === myEmailNorm
    );

    // 2️⃣ [규칙 1] Org Guard
    const effectiveOrgIds = getEffectiveAllowedOrgs(menu, allMenus);
    const orgPassed = isOrgAllowed(effectiveOrgIds, myDept, unitsList);

    // 3️⃣ [규칙 2] Access Level (미지정=제한 → 불허)
    const normalizedViewRoles = pVRoles.map((r: any) => {
      const m = String(r).match(/\d+/);
      return m ? `LV_${m[0]}` : String(r);
    });
    const levelPassed =
      normalizedViewRoles.length > 0 && normalizedViewRoles.includes(myRole);

    // 🎯 진입: Task Access(규칙1·2 예외) OR (Org ∧ Level)
    const hasAccessPassed = isTaskAccess || (orgPassed && levelPassed);

    // ---------------------------------------------------------
    // 📦 [결과] View Scope — 진입자 전원 동일 (Task Access도 예외 아님)
    // ---------------------------------------------------------
    const validViewScopes = normalizePermissionScopes(pVScopes);
    // 설정값 적용. 미지정=제한(NONE). Access View Scope는 필수 선택(Org와 동일)
    const viewScope = hasAccessPassed
      ? validViewScopes.length > 0
        ? pickWidestPermissionScope(validViewScopes)
        : 'NONE'
      : 'NONE';

    // ---------------------------------------------------------
    // ✍️ [편집 권한(EDIT) 관문] — Access 통과자만 대상
    // edit_scopes 미지정=NONE. Task Editor 개인 scope ∪ 규칙
    // ---------------------------------------------------------
    const editState = resolveInterfaceEditState(user, menu, { hasAccess: hasAccessPassed });
  
    return { 
      hasAccess: hasAccessPassed, 
      isMaster: false,
      isEditor: editState.isEditor, 
      isViewer: hasAccessPassed,
      viewScope,
      editScope: editState.editScope,
      myRole,
      isTaskAccess,
    };
  };