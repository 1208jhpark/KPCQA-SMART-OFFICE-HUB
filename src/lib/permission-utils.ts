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
  
  // 1. 상위 부서의 Org Guard(조직 권한)를 상속받아 계산하는 함수
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
    // 관리자가 부서를 지정하지 않았거나 'ALL'이면 "전체 부서 허용"으로 직행
    if (!effectiveOrgIds || effectiveOrgIds.length === 0 || effectiveOrgIds.includes('ALL')) {
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
      myRole: 'GUEST' 
    };
    
    if (!user || !menu) return defaultDeny;
  
    const myId = user.id || user.userId || user._id;
    const myEmail = user.email;
    const myDept = user.dept_id || user.unit_id || user.unit?.id;
  
    // 🚀 [치명적 버그 픽스]: 하이픈(-), 소문자, 공백 등 어떤 규격이 들어와도 "LV_숫자" 형태로 강제 통일
    const rolesArr = safeArray(user.roles);
    const firstRole = rolesArr[0] || user.role || user.level || 'LV_3';
    const levelMatch = String(firstRole).match(/\d+/);
    const myRole = levelMatch ? `LV_${levelMatch[0]}` : 'LV_3';
  
    // 👑 [MASTER 지정] 및 최고관리자(LV_1) 프리패스 룰
    const isMaster = menu.master_editor_id === myId;
    if (myRole === 'LV_1' || isMaster) {
      return { 
        hasAccess: true, 
        isMaster: true,
        isEditor: true, 
        isViewer: true,
        viewScope: 'TOTAL', // 마스터는 무조건 전사 데이터 조회
        editScope: 'TOTAL', // 마스터는 무조건 전사 데이터 편집
        myRole 
      };
    }
  
    // 데이터베이스 설정값 안전 추출
    const pVScopes = safeArray(menu.view_scopes);      // [결과] 보이는 화면 (Data Scope)
    const pEditScopes = safeArray(menu.edit_scopes);   // [결과] 편집 가능 범위 (Edit Scope)
    const pTAccess = safeArray(menu.task_accesses);    // 1️⃣ [예외] Task Access 명단
    const pTMasters = safeArray(menu.task_masters);    // 1️⃣ [예외] Task Editor 명단
    const pVRoles = safeArray(menu.view_role_ids);     // 3️⃣ [규칙] 접근 권한 레벨
    const pERoles = safeArray(menu.edit_role_ids);     // 2️⃣ [규칙] 편집 권한 레벨
  
    // ---------------------------------------------------------
    // 👁️ [접근 권한(ACCESS) 관문]
    // ---------------------------------------------------------
    // 1️⃣ 예외 지정자 확인 (Task Access)
    const isTaskAccess = pTAccess.some((ta: any) => ta.email === myEmail);
    
    // 2️⃣ 지정 부서 허용 확인 (Org Guard)
    const effectiveOrgIds = getEffectiveAllowedOrgs(menu, allMenus);
    const orgPassed = isOrgAllowed(effectiveOrgIds, myDept, unitsList);
    
    // 3️⃣ 접근 권한 레벨 확인 (비어있으면 전체 레벨 허용)
    const validVRoles = pVRoles.length > 0 ? pVRoles : ['LV_1', 'LV_2', 'LV_3']; 
    const levelPassed = validVRoles.includes(myRole);
  
    // 🎯 [최종 접근 판정]: 예외 대상자 이거나 (부서 통과 AND 레벨 통과)
    const hasAccessPassed = isTaskAccess || (orgPassed && levelPassed);
  
    // ---------------------------------------------------------
    // ✍️ [편집 권한(EDIT) 관문]
    // ---------------------------------------------------------
    // 1️⃣ 예외 지정자 확인 (Task Editor)
    const isTaskEditor = pTMasters.some((tm: any) => tm.email === myEmail);
    
    // 2️⃣ 편집 권한 레벨 확인 (비어있으면 전체 레벨 허용)
    const editLevelPassed = pERoles.length === 0 || pERoles.includes(myRole); 
    
    // 🎯 [최종 편집 판정]: 접근이 허용된 상태에서, 예외 편집자 이거나 편집 레벨 통과
    const isEditorPassed = hasAccessPassed && (isTaskEditor || editLevelPassed);
  
    // ---------------------------------------------------------
    // 📦 [데이터 스콥(SCOPE) 결과 매핑]
    // ---------------------------------------------------------
    // 어드민 설정값이 비어있을 경우를 대비한 기본값 처리
    const viewScope = hasAccessPassed ? (pVScopes[0] || 'TOTAL') : 'NONE';
    const editScope = isEditorPassed ? (pEditScopes[0] || 'OWN') : 'NONE';
  
    return { 
      hasAccess: hasAccessPassed, 
      isMaster: false,
      isEditor: isEditorPassed, 
      isViewer: hasAccessPassed,
      viewScope,
      editScope,
      myRole 
    };
  };