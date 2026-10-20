'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 
import { getKSTDateString } from '@/utils/dateUtils';
import {
  resolveTopOrgName,
  resolveGlobalMgmtDeptName,
  canDistributeMarketingOwnerDept,
  canEditTopOrgMarketingAsset,
  isGlobalMgmtOrgMember,
  canApplyMarketingItem,
  isSharedMarketingApplyItem,
  normalizeViewAllowToken,
} from '@/utils/orgUnits';
import {
  marketingDutyChipOptions,
  resolveDutyLabel,
  resolveUserDutyOptions,
  type UserJobOption,
} from '@/lib/user-job-options';
import { resolveInterfaceEditState, isSystemLv1User } from '@/lib/permission-utils';
import LoadingState from '@/components/common/LoadingState';

const MAX_IMAGE_BYTES = 500 * 1024; // 원본 파일 기준
const MAX_IMAGE_LABEL = '500KB';
/** base64 data URL 대략 한도 (500KB × 4/3 + 헤더) */
const MAX_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128;

async function readApiError(res: Response, fallback: string) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

/** 역할 문자열 정규화 (LV_1 / "1" / ["LV_1"] 등) */
function normalizeRoles(roles: unknown): string[] {
  if (!roles) return [];
  const arr = Array.isArray(roles) ? roles : [roles];
  return arr.map((r) => {
    const s = String(r).trim();
    const m = s.match(/(\d+)/);
    return m ? `LV_${m[1]}` : s;
  });
}

function emailsEqual(a?: string | null, b?: string | null) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function normalizeRoleId(r: unknown): string {
  return normalizeViewAllowToken(r);
}

/** 전사 허용 토글 → 저장 시 LV_1+LV_2+LV_3 */
const ALL_LV_TOGGLE_ID = 'ALL_LV';
const ALL_LV_IDS = ['LV_1', 'LV_2', 'LV_3'] as const;

/** 본부장·센터장 묶음 토글 */
const HQ_CENTER_TOGGLE_ID = 'HQ_CENTER';
const HQ_CENTER_IDS = ['본부장', '센터장'] as const;

function isAllLvChecked(roles: unknown): boolean {
  const list = Array.isArray(roles) ? roles.map(normalizeRoleId) : [];
  // 세 LV 모두, 또는 레거시 LV_3 단독(=전사 허용)
  return ALL_LV_IDS.every((id) => list.includes(id)) || list.includes('LV_3');
}

function applyAllLvToggle(cur: string[], checked: boolean): string[] {
  const normalized = cur.map(normalizeRoleId).filter(Boolean);
  const withoutLv = normalized.filter((r) => !(ALL_LV_IDS as readonly string[]).includes(r));
  if (checked) return Array.from(new Set([...withoutLv, ...ALL_LV_IDS]));
  return withoutLv;
}

function isHqCenterChecked(roles: unknown): boolean {
  const list = Array.isArray(roles) ? roles.map(normalizeRoleId) : [];
  return HQ_CENTER_IDS.every((id) => list.includes(id));
}

function applyHqCenterToggle(cur: string[], checked: boolean): string[] {
  const normalized = cur.map(normalizeRoleId).filter(Boolean);
  const without = normalized.filter((r) => !(HQ_CENTER_IDS as readonly string[]).includes(r));
  if (checked) return Array.from(new Set([...without, ...HQ_CENTER_IDS]));
  return without;
}

function isComboViewRoleToggle(id: string): boolean {
  return id === ALL_LV_TOGGLE_ID || id === HQ_CENTER_TOGGLE_ID || id === 'LV_3';
}

function isViewRoleChipChecked(id: string, roles: unknown): boolean {
  if (id === ALL_LV_TOGGLE_ID) return isAllLvChecked(roles);
  if (id === HQ_CENTER_TOGGLE_ID) return isHqCenterChecked(roles);
  const list = Array.isArray(roles) ? roles.map(normalizeRoleId) : [];
  return list.includes(id);
}

function applyViewRoleToggle(cur: string[], lv: string, checked: boolean): string[] {
  if (lv === ALL_LV_TOGGLE_ID || lv === 'LV_3') return applyAllLvToggle(cur, checked);
  if (lv === HQ_CENTER_TOGGLE_ID) return applyHqCenterToggle(cur, checked);
  const normalized = cur.map(normalizeRoleId).filter(Boolean);
  return checked
    ? Array.from(new Set([...normalized, lv]))
    : normalized.filter((r) => r !== lv);
}

/** 카드 배지용: 묶음 칩을 「전사 허용」「본부장·센터장」으로 표시, DUTY_* → 직책 한글 */
function formatViewRolesDisplay(roles: unknown, dutyOptions?: UserJobOption[] | null): string {
  const list = Array.isArray(roles) ? roles.map(normalizeRoleId).filter(Boolean) : [];
  const has전사 = isAllLvChecked(list);
  const hasHqCenter = isHqCenterChecked(list);
  const rest = list
    .filter(
      (id) =>
        !(ALL_LV_IDS as readonly string[]).includes(id) &&
        !(HQ_CENTER_IDS as readonly string[]).includes(id)
    )
    .map((id) => (id.startsWith('DUTY_') ? resolveDutyLabel(id, dutyOptions) || id : id));
  const parts = [
    ...(has전사 ? ['전사 허용'] : []),
    ...(hasHqCenter ? ['본부장·센터장'] : []),
    // 한쪽만 남은 레거시(본부장만 / 센터장만)
    ...(!hasHqCenter ? HQ_CENTER_IDS.filter((id) => list.includes(id)) : []),
    ...rest,
  ];
  return parts.join(', ');
}

function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
      
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  /** 지급이력 있는 물품 id (전체 지급행 로드 금지 — OOM 방지) */
  const [distLedgerItemIds, setDistLedgerItemIds] = useState<Set<string>>(new Set());
  /** 물품별 입고 건수 */
  const [purchaseCountsByItem, setPurchaseCountsByItem] = useState<Record<string, number>>({});
  const [currentUser, setCurrentUser] = useState<any>(null); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const MENU_PATH = '/marketing/distribution/catalog';
  
  const [unitOptions, setUnitOptions] = useState<string[]>(['EA', 'BOX', 'SET']);
      
  const [searchQuery, setSearchQuery] = useState('');
  /** owner_dept 이름 — 우리센터 → 본부 → 전사 순 칩 */
  const [selectedDept, setSelectedDept] = useState<string>('');
      
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  
  const [purchaseModal, setPurchaseModal] = useState<any>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    qty: '' as number | '',
    unit_price: 0,
    extra_cost: '' as number | '',
    vendor: '',
    purchase_date: getKSTDateString(),
    stock_in_date: getKSTDateString(),
  });
  /** 모달 안에서 텍스트 드래그 후 배경에서 mouseup 시 닫히는 것 방지 */
  const purchaseBackdropDownRef = useRef(false);

  /** 카탈로그 → 수량만 입력 후 재고 예약/승인 요청 */
  const [reserveModal, setReserveModal] = useState<{
    item: any;
    needsApproval: boolean;
  } | null>(null);
  const [reserveQty, setReserveQty] = useState<number | ''>(1);
  const [reservePurpose, setReservePurpose] = useState('');
  const [reserveSaving, setReserveSaving] = useState(false);
  const reserveBackdropDownRef = useRef(false);
      
  const initialForm = {
    name: '',
    unit_price: '' as string | number,
    extra_cost: '' as string | number,
    current_stock: '' as string | number,
    alert_qty: '' as string | number,
    owner_dept: '',
    owner_unit_id: null as string | null,
    description: '',
    image_url: '',
    owner_type: 'CENTER',
    unit: 'EA',
    view_role_ids: [] as string[],
    view_allow_apply: false,
  };
  const [formData, setFormData] = useState(initialForm);
      
  useEffect(() => {
    const searchFromUrl = searchParams.get('search');
    if (searchFromUrl) setSearchQuery(searchFromUrl);
  }, [searchParams]);
      
  useEffect(() => { fetchData(); }, []);

  /** register 등에서 예약 후 복귀 시 재고 즉시 반영 */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const fetchData = async () => {
    setLoadError(null);
    try {
      const ts = Date.now();
      const [iRes, uRes, meRes, ifRes, sysRes, masterRes, dRes, pRes, summaryRes] = await Promise.all([
        fetch('/api/marketing/items?t=' + ts),
        fetch('/api/admin/units?active=true&t=' + ts),
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/master-data?t=' + ts),
        fetch('/api/marketing/distributions?summary=itemLedger&t=' + ts),
        fetch('/api/marketing/purchases?summary=itemCounts&t=' + ts),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`),
      ]);
      
      const failed: string[] = [];
      if (!iRes.ok) failed.push('물품');
      if (!dRes.ok) failed.push('지급');
      if (!pRes.ok) failed.push('입고');
      if (!meRes.ok) failed.push('사용자');

      let systemConfigData = null;
      if (sysRes.ok) {
        const sysData = await sysRes.json();
        setSystemConfig(sysData);
        systemConfigData = sysData;
      }
      
      if (iRes.ok) setItems(await iRes.json());
      else setItems([]);
      if (uRes.ok) setUnits(await uRes.json());
      if (dRes.ok) {
        const ledger = await dRes.json();
        const ids = Array.isArray(ledger?.itemIds) ? ledger.itemIds : [];
        setDistLedgerItemIds(new Set(ids.map((id: string) => String(id))));
      } else {
        setDistLedgerItemIds(new Set());
      }
      if (pRes.ok) {
        const pc = await pRes.json();
        setPurchaseCountsByItem(pc?.counts && typeof pc.counts === 'object' ? pc.counts : {});
      } else {
        setPurchaseCountsByItem({});
      }
      
      if (meRes.ok) setCurrentUser(await meRes.json());
      if (ifRes.ok) {
        const interfaces = await ifRes.json();
        const config = interfaces.find((m: any) => m.path === MENU_PATH);
        setInterfaceConfig(config);
      }
      if (summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
      
      if (masterRes.ok && systemConfigData?.unit_category_group) {
        const masterData = await masterRes.json();
        const unitGroup = masterData.find((g: any) => g.id === systemConfigData.unit_category_group);
        if (unitGroup && unitGroup.codes) {
          const activeUnits = unitGroup.codes
            .filter((c: any) => c.is_active && !c.is_archived && c.is_visible)
            .sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((c: any) => c.label);
            
          if (activeUnits.length > 0) {
            setUnitOptions(activeUnits);
            setFormData(prev => ({ ...prev, unit: activeUnits[0] })); 
          }
        }
      }

      if (failed.length > 0) {
        const status = [iRes, dRes, pRes, meRes].find(r => !r.ok)?.status;
        setLoadError(
          status === 401
            ? '로그인 세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.'
            : status === 403
              ? '이 메뉴에 대한 접근 권한이 없습니다. 관리자에게 문의하세요.'
              : `일부 데이터를 불러오지 못했습니다. (${failed.join(', ')})`
        );
      }
    } catch(e) {
      console.error("데이터 로드 중 오류:", e);
      setLoadError('네트워크 오류로 카탈로그 데이터를 불러오지 못했습니다.');
    }
    setLoading(false);
  };
      
  const safeArray = (val: any) => {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) || []; } catch(e) { return []; }
  };
      
  const topOrgName = useMemo(() => resolveTopOrgName(units), [units]);
  const myRoles = useMemo(() => normalizeRoles(currentUser?.roles), [currentUser]);
  const isLv1 = myRoles.includes('LV_1');

  /** API resolveInterfaceEditState와 동일 — edit_scopes 비움=NONE(TOTAL 아님) */
  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );
  const canSeeAddForm = editState.isEditor;

  const checkEditPermission = (
    itemOwnerDept: string | null | undefined,
    itemOwnerUnitId?: string | null
  ) => {
    if (!currentUser || !systemConfig) return false;
    if (!editState.isEditor) return false;

    const myCenter = currentUser.unit?.unit_name;
    const myUnitId = String(currentUser.unit_id || currentUser.unit?.id || '').trim();
    const myHq = currentUser.unit?.parent?.unit_name;
    const globalMgmtDept = systemConfig.global_mgmt_dept;
    const ownerId = String(itemOwnerUnitId || '').trim();
    const topOrgId = topOrgName
      ? String(units.find((u) => String(u.unit_name || '').trim() === topOrgName)?.id || '').trim()
      : '';

    const isTop =
      (!!ownerId && !!topOrgId && ownerId === topOrgId) ||
      (!!topOrgName && itemOwnerDept === topOrgName);

    // Organization 자산 CRUD → GLOBAL_MGMT만 (TOTAL이어도 동일)
    if (isTop) {
      return canEditTopOrgMarketingAsset({
        ownerDept: itemOwnerDept || topOrgName,
        topOrgName,
        myUnitName: myCenter,
        myHqName: myHq,
        myUnitId,
        globalMgmtDept,
        units,
      });
    }

    // assertCanEditOwnerDept와 동일: TOTAL 전체 / OWN·DEPT는 본인 + (센터면) 상위 HQ
    const scope = editState.editScope;
    if (scope === 'TOTAL') return true;
    if (scope === 'DEPT' || scope === 'OWN') {
      if (ownerId && myUnitId && ownerId === myUnitId) return true;
      if (!ownerId && itemOwnerDept === myCenter) return true;

      // Center → 상위 HQ에도 신규 등록·수정 가능 (지급은 HQ 단에서 이뤄지도록)
      const myHqId = String(
        currentUser.unit?.parent?.id ||
          units.find((u) => String(u.id || '').trim() === myUnitId)?.parent_id ||
          ''
      ).trim();
      if (myHqId && ownerId && ownerId === myHqId) return true;
      if (myHq && itemOwnerDept === myHq) return true;
    }
    return false;
  };

  /**
   * 지급 신청(버튼)·칩 카운트:
   * 본인 소속/본부/하위 + 전사 풀은 view_role_ids(LV·직책) 게이트
   */
  const dutyOptions = useMemo(
    () => resolveUserDutyOptions(systemConfig?.user_duty_options),
    [systemConfig?.user_duty_options]
  );

  const checkDistributePermission = (item: {
    owner_dept?: string | null;
    owner_unit_id?: string | null;
    view_role_ids?: unknown;
    view_allow_apply?: boolean | null;
  }) => {
    if (!currentUser) return false;
    return canApplyMarketingItem(item, {
      myUnitName: currentUser.unit?.unit_name,
      myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
      myHqName: currentUser.unit?.parent?.unit_name,
      topOrgName,
      units,
      isPower: isLv1,
      userRoles: currentUser.roles,
      userDuty: currentUser.duty,
      dutyCode: currentUser.duty_code,
      dutyOptions,
      globalMgmtDept: systemConfig?.global_mgmt_dept,
    });
  };

  /** 등록/수정 시 선택 가능한 owner_dept (편집 스코프 내만) */
  const editableOwnerUnits = useMemo(() => {
    return units.filter((u) => u?.unit_name && checkEditPermission(u.unit_name, u.id));
  }, [units, currentUser, systemConfig, topOrgName, editState.isEditor, editState.editScope]);

  /** 신규 등록 드롭다운: 최상위(Organization) 제외 — 센터/본부로만 일반 등록 */
  const registerOwnerUnits = useMemo(() => {
    const top = String(topOrgName || '').trim();
    const topId = top
      ? String(units.find((u) => String(u.unit_name || '').trim() === top)?.id || '').trim()
      : '';
    return editableOwnerUnits.filter((u) => {
      const name = String(u.unit_name || '').trim();
      const id = String(u.id || '').trim();
      if (top && name === top) return false;
      if (topId && id === topId) return false;
      return true;
    });
  }, [editableOwnerUnits, topOrgName, units]);

  /** 신규 등록 기본 조직 = 로그인 소속(센터→센터, 본부→본부). 비어 있을 때만 */
  useEffect(() => {
    if (!canSeeAddForm || formData.owner_dept) return;
    const myName = String(currentUser?.unit?.unit_name || '').trim();
    const myId = String(
      currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id || ''
    ).trim();
    const mine =
      registerOwnerUnits.find(
        (u) =>
          (myId && String(u.id || '').trim() === myId) ||
          (myName && String(u.unit_name || '').trim() === myName)
      ) || registerOwnerUnits[0];
    if (!mine) return;
    setFormData((prev) =>
      prev.owner_dept
        ? prev
        : { ...prev, owner_dept: mine.unit_name, owner_unit_id: mine.id || null }
    );
  }, [canSeeAddForm, formData.owner_dept, currentUser, registerOwnerUnits]);

  /** admin/settings GLOBAL_MGMT(+직속 하위)만 열람 LV 설정 */
  const canSetViewRoles = useMemo(() => {
    if (isLv1) return true;
    if (!currentUser || !systemConfig) return false;
    return isGlobalMgmtOrgMember({
      myUnitName: currentUser.unit?.unit_name,
      myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
      globalMgmtDept: systemConfig.global_mgmt_dept,
      units,
    });
  }, [currentUser, systemConfig, units, isLv1]);

  /** 노란 GLOBAL_MGMT 권한 패널: 관리조직(최상위) 선택 시에만 */
  /** 관리조직(최상위) / 레거시 전사(Organization) 소유 */
  const isTopOrgOwnerDept = (ownerDept?: string | null) =>
    !!topOrgName && String(ownerDept || '').trim() === topOrgName;

  /**
   * GLOBAL_MGMT가 공유(view_role) 설정 가능한 소유 부서
   * - 우리센터/본부(총괄 패밀리) 물품 + 레거시 전사 소유
   */
  const canShareOwnerDept = (ownerDept?: string | null, ownerUnitId?: string | null) => {
    if (!canSetViewRoles) return false;
    if (isTopOrgOwnerDept(ownerDept)) return true;
    return isGlobalMgmtOrgMember({
      myUnitName: ownerDept,
      myUnitId: ownerUnitId,
      globalMgmtDept: systemConfig?.global_mgmt_dept,
      units,
    });
  };

  /** 「전사 · 신청가능」탭 키 — owner_dept 이름과 충돌 방지 */
  const SHARED_TAB_KEY = '__SHARED_APPLY__';

  const sharedApplyOpts = () => ({
    myUnitName: currentUser?.unit?.unit_name,
    myUnitId: currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id,
    myHqName: currentUser?.unit?.parent?.unit_name,
    topOrgName,
    units,
    isPower: isLv1,
    userRoles: currentUser?.roles,
    userDuty: currentUser?.duty,
    dutyCode: currentUser?.duty_code,
    dutyOptions,
    globalMgmtDept: systemConfig?.global_mgmt_dept,
  });

  /** /admin/settings 에 지정된 GLOBAL_MGMT 부서명 */
  const globalMgmtDeptLabel = useMemo(
    () => resolveGlobalMgmtDeptName(systemConfig?.global_mgmt_dept, units) || '미지정',
    [systemConfig, units]
  );

  /** 직책 칩 = SystemConfig 코드 기준 + 전사 허용 (묶음 칩 없음) */
  const VIEW_ROLE_OPTIONS_BASE = useMemo(() => {
    const dutyChips = marketingDutyChipOptions(dutyOptions).map((d) => ({
      id: String(d.code || '').trim(),
      label: d.label,
    }));
    return [
      { id: 'LV_1', label: 'LV_1' },
      ...dutyChips.filter((c) => c.id),
      { id: ALL_LV_TOGGLE_ID, label: '전사 허용' },
    ];
  }, [dutyOptions]);

  /**
   * TODO(restore): 신규등록 view_role 칩 — LV_1·원장·부원장·상무
   * 복구 시 아래 Set을 비우거나 해당 id를 제거
   */
  const REGISTER_VIEW_ROLE_HIDDEN_IDS = useMemo(
    () => new Set(['LV_1', 'DUTY_CEO', 'DUTY_VP', 'DUTY_EXEC']),
    []
  );

  const viewRoleOptionsFor = (roles: unknown) => {
    const list = Array.isArray(roles) ? roles.map(normalizeRoleId) : [];
    // 전사 허용이 LV_2를 넣어도 UI는 그대로. 구버전 칩은 LV_2만 단독 저장된 레거시만
    const onlyLegacyLv2 =
      list.includes('LV_2') && !list.includes('LV_1') && !list.includes('LV_3');
    if (onlyLegacyLv2) {
      return [
        { id: 'LV_1', label: 'LV_1' },
        { id: 'LV_2', label: 'LV_2(구버전·전체)' },
        ...VIEW_ROLE_OPTIONS_BASE.filter((o) => o.id !== 'LV_1' && o.id !== ALL_LV_TOGGLE_ID),
        { id: ALL_LV_TOGGLE_ID, label: '전사 허용' },
      ];
    }
    return [...VIEW_ROLE_OPTIONS_BASE];
  };

  const toggleFormViewRole = (lv: string, checked: boolean) => {
    setFormData((prev) => {
      const cur = Array.isArray(prev.view_role_ids) ? prev.view_role_ids.map(String) : [];
      const next = applyViewRoleToggle(cur, lv, checked);
      return {
        ...prev,
        view_role_ids: next,
        view_allow_apply: next.length > 0,
      };
    });
  };

  const toggleEditViewRole = (lv: string, checked: boolean) => {
    setEditFormData((prev: any) => {
      const cur = Array.isArray(prev.view_role_ids) ? prev.view_role_ids.map(normalizeRoleId) : [];
      const next = applyViewRoleToggle(cur, lv, checked);
      return {
        ...prev,
        view_role_ids: next,
        view_allow_apply: next.length > 0,
      };
    });
  };

  /** 활성 리스트(비수정): GLOBAL_MGMT가 공유 물품 열람·신청 권한을 바로 저장 */
  const saveItemViewRoles = async (
    item: { id: string; owner_dept?: string | null },
    nextRoles: string[]
  ) => {
    // 레거시 전사 소유만 최소 1개 필수. 센터 공유는 비우면 타부서 비공개
    if (isTopOrgOwnerDept(item.owner_dept) && nextRoles.length === 0) {
      alert('전사(최상위) 물품은 「부서 열람 및 신청 권한 지정」을 1개 이상 선택해야 합니다.');
      return;
    }
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: item.id,
        view_role_ids: nextRoles,
        view_allow_apply: nextRoles.length > 0,
      }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, view_role_ids: nextRoles, view_allow_apply: nextRoles.length > 0 }
            : i
        )
      );
    } else {
      alert(await readApiError(res, '권한 저장에 실패했습니다.'));
      fetchData();
    }
  };

  const toggleListViewRole = (
    item: { id: string; owner_dept?: string | null; view_role_ids?: unknown },
    lv: string,
    checked: boolean
  ) => {
    const cur = Array.isArray(item.view_role_ids) ? item.view_role_ids.map(String) : [];
    const next = applyViewRoleToggle(cur, lv, checked);
    void saveItemViewRoles(item, next);
  };

  /** 지급 신청 이력만 — 입고만 있으면 삭제 가능(입고도 함께 삭제) */
  const itemHasDistLedger = (itemId: string) => distLedgerItemIds.has(itemId);

  const purchaseCountForItem = (itemId: string) => Number(purchaseCountsByItem[itemId] || 0);
      
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 등록할 수 있습니다.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      alert(`이미지는 ${MAX_IMAGE_LABEL} 이하만 등록할 수 있습니다.\n(선택한 파일: ${(file.size / 1024).toFixed(0)}KB)\n용량을 줄인 뒤 다시 시도해 주세요.`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      if (result && result.length > MAX_IMAGE_DATA_URL_CHARS) {
        alert(`이미지 데이터가 너무 큽니다. ${MAX_IMAGE_LABEL} 이하로 줄여 주세요.`);
        e.target.value = '';
        return;
      }
      if (isEdit) setEditFormData({ ...editFormData, image_url: result });
      else setFormData({ ...formData, image_url: result });
    };
    reader.readAsDataURL(file);
  };
      
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.owner_dept) return alert("물품명과 조직은 필수입니다.");
    // 신규 등록은 일반(센터/본부)만 — 공유 권한은 등록 후 리스트에서 지정
    const { view_role_ids: _vr, view_allow_apply: _va, ...rest } = formData;
    const basePayload = {
      ...rest,
      view_role_ids: [],
      view_allow_apply: false,
      creator_name: currentUser?.name || null,
      creator_dept: currentUser?.unit?.unit_name || null,
    };
    const payload = {
      ...basePayload,
      owner_unit_id:
        units.find((u) => u.unit_name === formData.owner_dept)?.id ||
        formData.owner_unit_id ||
        null,
      unit_price: Number(formData.unit_price) || 0,
      // TODO(restore): 신규등록 부대비용 UI 복구 시 → Number(formData.extra_cost) || 0
      extra_cost: 0,
      current_stock: Number(formData.current_stock) || 0,
      // TODO(restore): 신규등록 재고확보기준수량 UI 복구 시 formData.alert_qty 그대로 사용
      alert_qty: Number(formData.alert_qty) || 0,
    };
    const res = await fetch('/api/marketing/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('신규 물품이 등록되었습니다.');
      setFormData({ ...initialForm, unit: unitOptions[0] || 'EA' });
      fetchData();
    } else {
      alert(await readApiError(res, '등록에 실패했습니다.'));
    }
  };
      
  const handleOpenEdit = (item: any) => {
    setEditingId(item.id);
    const roles = Array.isArray(item.view_role_ids)
      ? item.view_role_ids.map(normalizeRoleId)
      : [];
    setEditFormData({
      ...item,
      unit: item.unit || 'EA',
      view_role_ids: roles,
      view_allow_apply: roles.length > 0,
    });
  };
      
  const handleSaveEdit = async () => {
    try {
      const {
        view_role_ids,
        view_allow_apply,
        unit_price,
        unit,
        current_stock,
        ...safeEdit
      } = editFormData;
      const lockedByDist = editingId ? itemHasDistLedger(editingId) : false;
      const stockNum = Math.floor(Number(current_stock));
      if (!Number.isFinite(stockNum) || stockNum < 0) {
        return alert('재고는 0 이상 정수여야 합니다.');
      }
      // 열람 LV·직책: GLOBAL_MGMT + 최상위 조직 물품만(최소 1개 필수) — 그 외는 비우고 저장
      const ownerDeptName = String(editFormData.owner_dept || '').trim();
      const ownerUnitId = editFormData.owner_unit_id ?? null;
      const includeViewRoles = canShareOwnerDept(ownerDeptName, ownerUnitId);
      const roles = Array.isArray(view_role_ids) ? view_role_ids : [];
      if (includeViewRoles && isTopOrgOwnerDept(ownerDeptName) && roles.length === 0) {
        return alert('전사(최상위) 물품은 「부서 열람 및 신청 권한 지정」을 1개 이상 선택해야 합니다.');
      }
      let payload: Record<string, unknown> = includeViewRoles
        ? {
            ...safeEdit,
            view_role_ids: roles,
            view_allow_apply: roles.length > 0,
          }
        : canSetViewRoles
          ? { ...safeEdit, view_role_ids: [], view_allow_apply: false }
          : { ...safeEdit };
      // 입고 버튼 숨김 대체: 수정에서 재고 직접 변경
      payload.current_stock = stockNum;
      if (payload.owner_dept && !payload.owner_unit_id) {
        payload.owner_unit_id =
          units.find((u) => u.unit_name === payload.owner_dept)?.id || null;
      }
      // 지급이력 있으면 단가·단위 변경 차단 (단위와 동일 정책)
      if (!lockedByDist) {
        if (unit_price !== undefined) payload.unit_price = unit_price;
        if (unit !== undefined) payload.unit = unit;
      }
      const res = await fetch('/api/marketing/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('✅ 정상적으로 수정되었습니다.');
        setEditingId(null);
        fetchData();
      } else {
        alert(await readApiError(res, '수정에 실패했습니다.'));
      }
    } catch (error) {
      alert('오류가 발생했습니다.');
    }
  };
      
  const handleDelete = async (id: string) => {
    if (itemHasDistLedger(id)) {
      return alert('지급 신청 이력이 있어 삭제할 수 없습니다.\n종료(마감) 처리를 사용하세요.');
    }
    const pCount = purchaseCountForItem(id);
    const msg =
      pCount > 0
        ? `지급 신청 이력이 없어 삭제합니다.\n입고 이력 ${pCount}건도 함께 삭제됩니다. (부서 입고 장부에서도 사라집니다.)\n계속할까요?`
        : '잘못 등록된 물품을 삭제합니다.\n계속할까요?';
    if (!confirm(msg)) return;
    const res = await fetch(`/api/marketing/items?id=${id}`, { method: 'DELETE' });
    if (res.ok) { alert('삭제되었습니다.'); fetchData(); }
    else {
      alert(await readApiError(res, '삭제에 실패했습니다.'));
    }
  };
      
  const handleEndItem = async (id: string) => {
    if (!confirm('지급 신청 이력이 있는 물품입니다.\n카탈로그에서 숨기고 부서지급대장(종료 물품)으로 넘기시겠습니까?')) return;

    // creator_* 는 최초 등록자 보존 — 종료 시 덮어쓰지 않음
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: true })
    });
    if (res.ok) {
      fetchData();
      const go = confirm(
        '종료 처리되었습니다.\n부서지급대장 > 종료 물품 화면으로 이동할까요?'
      );
      if (go) router.push('/marketing/distribution/dept?tab=ARCHIVED');
    } else {
      alert(await readApiError(res, '종료 처리에 실패했습니다.'));
    }
  };
  
  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(purchaseForm.qty);
    if (!qty || qty <= 0) return alert('수량은 1개 이상이어야 합니다.');
    const catalogPrice = Number(purchaseModal?.unit_price) || 0;
    const inboundPrice = Number(purchaseForm.unit_price) || 0;
    const extraCost = Number(purchaseForm.extra_cost) || 0;
    if (inboundPrice !== catalogPrice) {
      return alert(
        '물품 단가는 등록된 단가와 같아야 합니다.\n단가가 변경된 경우 신규 기념품으로 등록해 주세요.'
      );
    }
    if (extraCost < 0) return alert('부대비용은 0 이상이어야 합니다.');
    if (!String(purchaseForm.vendor || '').trim()) return alert('구입처(벤더/업체명)를 입력하세요.');
    const payload = {
      qty,
      unit_price: catalogPrice,
      extra_cost: extraCost,
      vendor: purchaseForm.vendor,
      note: '',
      // 비품 대시보드와 동일: 장부 기록일은 창고 입고 일자
      purchase_date: purchaseForm.stock_in_date,
      item_id: purchaseModal.id,
      purchaser_name: currentUser?.name || '관리자',
      purchaser_dept: currentUser?.unit?.unit_name || '미소속'
    };
    try {
      const res = await fetch('/api/marketing/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setPurchaseModal(null);
        fetchData();
        alert('입고(재고보충)가 완료되었습니다.');
      } else {
        alert(await readApiError(res, '입고 처리에 실패했습니다.'));
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    }
  };

  const openReserveModal = (item: any, needsApproval: boolean) => {
    setReserveModal({ item, needsApproval });
    setReserveQty(1);
    setReservePurpose('');
  };

  const handleReserveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reserveModal?.item) return;
    const item = reserveModal.item;
    const needsApproval = reserveModal.needsApproval;
    const qty = Number(reserveQty);
    if (!qty || qty < 1) return alert('지급 개수는 1개 이상이어야 합니다.');
    if (qty > Number(item.current_stock || 0)) {
      return alert('입력 수량이 현재 재고보다 많습니다!');
    }
    setReserveSaving(true);
    try {
      const res = await fetch('/api/marketing/distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          qty,
          purpose: reservePurpose.trim(),
          dist_date: getKSTDateString(),
          client_id: null,
          client_name: '',
          client_dept: '',
          requires_approval: needsApproval,
        }),
      });
      if (res.ok) {
        setReserveModal(null);
        await fetchData();
        alert(
          needsApproval
            ? '✅ 예약 대기가 등록되었습니다.\n재고는 즉시 예약(차감)되며, 관리자 확정 후 지급이 완료됩니다.\n\n이력은 「재고 예약」 화면에서 확인할 수 있습니다.'
            : '✅ 재고 예약이 등록되었습니다.\n\n이력은 「재고 예약」 화면에서 확인할 수 있습니다.'
        );
      } else {
        alert(await readApiError(res, '재고 예약에 실패했습니다.'));
      }
    } catch {
      alert('통신 오류가 발생했습니다.');
    } finally {
      setReserveSaving(false);
    }
  };
      
  const activeItems = useMemo(() => items.filter(item => !item.is_archived), [items]);

  /**
   * 칩 순서: 1) 우리센터 2) 본부 3) 전사 · 신청가능(공유 풀)
   * - 공유 풀: 타부서 view_role로 열린 물품 (소유는 경영센터 등, 재고·비용은 소유부서)
   */
  const scopeTabs = useMemo(() => {
    type Tab = { key: string; label: string; hint: string };
    const tabs: Tab[] = [];
    const myUnit = String(currentUser?.unit?.unit_name || '').trim();
    const myHq = String(currentUser?.unit?.parent?.unit_name || '').trim();
    const top = String(topOrgName || '').trim();
    const seen = new Set<string>();

    const push = (key: string, label: string, hint: string) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      tabs.push({ key, label, hint });
    };

    if (myUnit && myUnit === top) {
      push(myUnit, myUnit, '우리조직');
      push(SHARED_TAB_KEY, '전사 · 신청가능', '공유된 신청가능 물품');
      return tabs;
    }

    if (myUnit && myHq && myHq !== top) {
      push(myUnit, myUnit, '우리센터');
      push(myHq, myHq, '본부');
      push(SHARED_TAB_KEY, '전사 · 신청가능', '공유된 신청가능 물품');
      return tabs;
    }

    if (myUnit) push(myUnit, myUnit, myHq === top || !myHq ? '우리본부' : '우리센터');
    push(SHARED_TAB_KEY, '전사 · 신청가능', '공유된 신청가능 물품');
    return tabs;
  }, [currentUser, topOrgName]);

  // 기본 선택: 1순위(우리센터). URL dept가 칩에 있으면 유지
  useEffect(() => {
    if (scopeTabs.length === 0) return;
    const keys = scopeTabs.map((t) => t.key);
    if (selectedDept && keys.includes(selectedDept)) return;
    const fromUrl = searchParams.get('dept');
    if (fromUrl && keys.includes(fromUrl)) {
      setSelectedDept(fromUrl);
      return;
    }
    setSelectedDept(keys[0]);
  }, [scopeTabs, selectedDept, searchParams]);

  const filteredActiveItems = useMemo(() => {
    return activeItems.filter((item) => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;

      if (selectedDept === SHARED_TAB_KEY) {
        return isSharedMarketingApplyItem(item, sharedApplyOpts());
      }

      const matchDept = !selectedDept || item.owner_dept === selectedDept;
      if (!matchDept) return false;

      // 신청가능만 노출 (+ Edit 가능 본인 관리 물품은 구조적으로 포함)
      return checkDistributePermission(item);
    });
  }, [activeItems, searchQuery, selectedDept, currentUser, topOrgName, units, isLv1, systemConfig, editState]);
      
  if (loading) return <LoadingState />;
      
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">

      {loadError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-2xl text-xs font-bold flex justify-between items-center gap-4">
          <span>⚠️ {loadError}</span>
          <button type="button" onClick={() => { setLoading(true); fetchData(); }} className="shrink-0 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-black hover:bg-amber-700">
            새로고침
          </button>
        </div>
      )}
      
      {/* 마케팅 배너 공통 규격: label 10px / title 2xl / desc xs · mb-2.5 · mt-3 · chips mt-4 */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-indigo-900/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-2.5">
            MARKETING ASSET CATALOG
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
          기념품 조회 및 재고 예약
          </h1>
          <p className="text-white/70 text-xs mt-3 leading-relaxed">
          전사 및 부서별 기념품 현황을 확인하고 출고 전 수량을 미리 예약합니다. (신규 등록 및 재고 관리는 담당 부서 전용)
          </p>
          {permissionSummary && isSystemLv1User(currentUser) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-blue-50 shadow-sm">
                <span>👑 Master 책임자:</span>
                <span>{permissionSummary.masterName}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-purple-500/20 border-purple-300/40 text-purple-100 shadow-sm">
                <span>👁️ Access:</span>
                <span>{permissionSummary.accessDesignate}</span>
                <span className="opacity-50">|</span>
                <span className="truncate max-w-[160px]">Org: {permissionSummary.accessOrg}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.accessLevel}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-sm">
                <span>✍️ Edit:</span>
                <span>{permissionSummary.editDesignate}</span>
                <span className="opacity-50">|</span>
                <span>Level: {permissionSummary.editLevel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {canSeeAddForm && (
        <div className="bg-white border border-slate-500 rounded-[2.5rem] shadow-sm p-6 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-4 px-2">
            <span className="w-6 h-6 bg-indigo-600 text-white rounded-md flex items-center justify-center text-xs font-black">＋</span>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">신규 기념품 등록 <span className="text-slate-400 font-normal">(입고 단가가 변경되면 신규로 등록하세요.)</span></h3>
          </div>
          
          <form onSubmit={handleRegister} className="flex flex-col lg:flex-row gap-3 items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 shrink-0 bg-white border-2 border-dashed border-indigo-200 rounded-xl flex items-center justify-center cursor-pointer hover:border-indigo-500 transition-all overflow-hidden"
              title={`이미지 ${MAX_IMAGE_LABEL} 이하`}
            >
              {formData.image_url ? (
                <img src={formData.image_url} className="w-full h-full object-cover" alt="preview" />
              ) : (
                <span className="text-sm leading-none">📸</span>
              )}
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, false)} />

            <div className="flex-1 w-full grid grid-cols-2 lg:grid-cols-7 gap-2.5">
              <input required placeholder="물품명 *" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 focus:bg-white transition-all" />
              <select
                required
                value={formData.owner_dept}
                onChange={(e) => {
                  const name = e.target.value;
                  const u = registerOwnerUnits.find((x) => x.unit_name === name);
                  setFormData({
                    ...formData,
                    owner_dept: name,
                    owner_unit_id: u?.id || null,
                  });
                }}
                className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all"
              >
                <option value="">관리 조직 선택 *</option>
                {registerOwnerUnits.map((u) => (
                  <option key={u.id} value={u.unit_name}>
                    {u.unit_name}
                  </option>
                ))}
              </select>
              <input type="number" min="0" placeholder="물품 단가(원)" value={formData.unit_price ?? ''} onChange={e=>setFormData({...formData, unit_price: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="개당 단가" />
              {/* TODO(restore): 신규등록 부대비용 — 복구 시 아래 주석 해제 + handleRegister extra_cost를 formData 값으로
              <input type="number" min="0" placeholder="부대비용(원)" value={formData.extra_cost ?? ''} onChange={e=>setFormData({...formData, extra_cost: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-orange-200 rounded-xl outline-none focus:ring-2 ring-orange-400 transition-all" title="배송비, 인쇄비, 세금 등 (없으면 0)" />
              */}
              <input type="number" min="0" placeholder="재고수량" value={formData.current_stock ?? ''} onChange={e=>setFormData({...formData, current_stock: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              {/* TODO(restore): 신규등록 재고확보기준수량 — 복구 시 아래 주석 해제 (payload는 이미 formData.alert_qty 사용)
              <input type="number" min="0" placeholder="재고확보기준수량" value={formData.alert_qty ?? ''} onChange={e=>setFormData({...formData, alert_qty: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="이 수량 이하로 떨어지면 알림이 뜹니다." />
              */}
              <select value={formData.unit || ''} onChange={e=>setFormData({...formData, unit: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all cursor-pointer">
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all col-span-2" />
            </div>

            <button type="submit" className="w-full lg:w-24 shrink-0 h-10 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95">신규등록(Edit)</button>
          </form>
        </div>
      )}
      
      <div className="mt-8 mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-medium text-sm text-slate-800 flex items-center gap-2 pl-0.5">
            <span>🛍️</span> 활성 물품 리스트
          </h3>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {scopeTabs.map((tab) => {
              const count = activeItems.filter((i) => {
                if (tab.key === SHARED_TAB_KEY) {
                  return isSharedMarketingApplyItem(i, sharedApplyOpts());
                }
                if (i.owner_dept !== tab.key) return false;
                return checkDistributePermission(i);
              }).length;
              const selected = selectedDept === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSelectedDept(tab.key)}
                  title={tab.hint}

                  className={`inline-flex items-baseline gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                  }`}
                >
                  <span className="leading-none">{tab.label}</span>
                  <span
                    className={`text-[10px] font-mono font-bold tabular-nums leading-none ${
                      selected ? 'text-indigo-200' : 'text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative w-full sm:w-72 shrink-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="물품명 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-9 pr-3 bg-white border border-slate-200 rounded-lg text-xs font-normal outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredActiveItems.map(item => {
          const isEditing = editingId === item.id;
          const currentData = isEditing ? editFormData : item;
          const canDistribute = checkDistributePermission(item);
          const canEditThisItem = checkEditPermission(item.owner_dept, item.owner_unit_id);
          const myUnitName = String(currentUser?.unit?.unit_name || '').trim();
          const myUnitId = String(
            currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id || ''
          ).trim();
          const itemOwnerId = String(item.owner_unit_id || '').trim();
          const itemOwnerDept = String(item.owner_dept || '').trim();
          // 단가: 본인 소속 물품만 (HQ·전사는 재고만)
          const showUnitPrice =
            (!!myUnitId && !!itemOwnerId && itemOwnerId === myUnitId) ||
            (!!myUnitName && !!itemOwnerDept && itemOwnerDept === myUnitName);
          
          const currentUnit = currentData.unit || 'EA';
          const hasLedger = itemHasDistLedger(item.id);
          const inStock = canDistribute && item.current_stock > 0;
          const viaStructural = canDistributeMarketingOwnerDept(item.owner_dept, {
            myUnitName: currentUser?.unit?.unit_name,
            myUnitId: currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id,
            myHqName: currentUser?.unit?.parent?.unit_name,
            topOrgName,
            units,
            isPower: isLv1,
            ownerUnitId: item.owner_unit_id,
            excludeTopOrgPool: true,
          });
          // 전사 풀·타부서 LV/직책 개방 → 승인 요청(앰버)
          const needsApprovalRequest = inStock && canDistribute && !viaStructural;
      
          return (
            <div key={item.id} className={`flex flex-col sm:flex-row sm:items-stretch gap-0 p-5 bg-white border rounded-[2rem] transition-all shadow-sm relative group ${isEditing ? 'border-indigo-500 ring-4 ring-indigo-50 z-50' : 'border-slate-200 hover:shadow-md'}`}>
              
              <div 
                onClick={() => isEditing && editFileInputRef.current?.click()}
                className={`w-full sm:w-32 sm:h-32 h-36 shrink-0 bg-slate-50 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-100 relative ${isEditing ? 'cursor-pointer' : ''}`}
              >
                {currentData.image_url ? (
                  <img src={currentData.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="img" />
                ) : <span className="text-slate-300 font-medium text-[10px] uppercase tracking-widest">No Image</span>}
                
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white font-medium text-xs animate-in fade-in gap-0.5 px-2 text-center">
                    <span>📸 사진 변경</span>
                    <span className="text-[9px] font-normal opacity-80">≤{MAX_IMAGE_LABEL}</span>
                  </div>
                )}
                
              </div>
      
              <div className="min-w-0 flex-1 flex flex-col justify-between gap-3 sm:ml-4 mt-4 sm:mt-0 sm:min-h-[8rem]">
                <div className="flex items-start gap-2 min-w-0">
                  {isEditing ? (
                    <input value={currentData.name} onChange={e=>setEditFormData({...editFormData, name: e.target.value})} className="min-w-0 flex-1 font-bold text-base text-blue-600 bg-blue-50 px-2 py-1 rounded outline-none border-b border-blue-200" />
                  ) : (
                    <h4 className={`min-w-0 flex-1 text-base font-bold leading-snug line-clamp-2 ${canDistribute ? 'text-slate-900' : 'text-slate-400'}`}>{currentData.name}</h4>
                  )}
                  {!isEditing && (
                    <div className="flex flex-col items-end gap-1 shrink-0 max-w-[42%]">
                      <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md border truncate max-w-full ${canDistribute ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                        {item.owner_dept}
                      </span>
                      {!(canShareOwnerDept(item.owner_dept, item.owner_unit_id)) &&
                        Array.isArray(item.view_role_ids) &&
                        item.view_role_ids.length > 0 && (
                        <span
                          className="text-[8px] font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-right leading-tight break-words"
                          title="체크한 LV·직책만 열람·신청 (전사 물품은 최소 1개 필수)"
                        >
                          열람·신청 {formatViewRolesDisplay(item.view_role_ids, dutyOptions)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 재고~상세설명: 제목과 간격 두고 카드 하단으로 */}
                <div className="flex flex-col gap-2.5 w-full mt-1">
                {/* 단가·재고·단위·부서 — 한 줄 (라벨 상단 정렬 · 값 글자 크기 통일) */}
                <div
                  className={`grid gap-x-3 gap-y-1.5 w-full items-start ${
                    showUnitPrice ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'
                  }`}
                >
                  {showUnitPrice && (
                    <div className="flex flex-col min-w-0 gap-0.5">
                      <span className="text-slate-400 font-normal text-[9px] leading-none h-3 truncate">
                        물품 단가(원)
                        {isEditing && hasLedger ? ' ·잠금' : ''}
                      </span>
                      {isEditing ? (
                        <input
                          type="number"
                          disabled={hasLedger}
                          title={
                            hasLedger
                              ? '지급 신청 이력이 있어 단가를 변경할 수 없습니다. 단가가 바뀐 상품은 신규 등록해 주세요.'
                              : undefined
                          }
                          value={currentData.unit_price}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, unit_price: e.target.value })
                          }
                          className={`font-mono font-medium text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 w-full text-[11px] leading-none ${
                            hasLedger ? 'cursor-not-allowed opacity-60' : ''
                          }`}
                        />
                      ) : (
                        <span className="font-mono font-medium text-slate-700 text-[11px] leading-none truncate">
                          {Number(currentData.unit_price || 0).toLocaleString()}
                          <span className="text-[9px] font-normal ml-0.5">원</span>
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="text-slate-400 font-normal text-[9px] leading-none h-3">재고</span>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={currentData.current_stock ?? ''}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, current_stock: e.target.value })
                        }
                        className="font-mono font-medium text-indigo-600 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[11px] leading-none w-full"
                      />
                    ) : (
                      <span
                        className={`font-mono font-medium text-[11px] leading-none ${
                          !canDistribute ? 'text-slate-400' : 'text-indigo-600'
                        }`}
                      >
                        {currentData.current_stock}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="text-slate-400 font-normal text-[9px] leading-none h-3 truncate">
                      물품 단위
                      {isEditing && hasLedger ? ' ·잠금' : ''}
                    </span>
                    {isEditing ? (
                      <select
                        disabled={hasLedger}
                        title={
                          hasLedger
                            ? '지급 신청 이력이 있어 단위를 변경할 수 없습니다. 단위가 바뀐 상품은 신규 등록해 주세요.'
                            : undefined
                        }
                        value={currentData.unit || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, unit: e.target.value })}
                        className={`font-medium text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[11px] leading-none w-full ${
                          hasLedger ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                        }`}
                      >
                        {currentData.unit &&
                          !unitOptions.includes(String(currentData.unit)) && (
                            <option value={currentData.unit}>{currentData.unit}</option>
                          )}
                        {unitOptions.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-medium text-slate-700 text-[11px] leading-none truncate">
                        {currentUnit}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="text-slate-400 font-normal text-[9px] leading-none h-3 truncate">
                      {isEditing ? '부서 변경' : '관리 부서'}
                    </span>
                    {isEditing ? (
                      <select
                        value={currentData.owner_dept}
                        onChange={(e) => {
                          const name = e.target.value;
                          const u = editableOwnerUnits.find((x) => x.unit_name === name);
                          setEditFormData({
                            ...editFormData,
                            owner_dept: name,
                            owner_unit_id: u?.id || null,
                          });
                        }}
                        className="font-medium text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[11px] leading-none w-full"
                      >
                        {editableOwnerUnits.map((u) => (
                          <option key={u.id} value={u.unit_name}>
                            {u.unit_name}
                          </option>
                        ))}
                        {currentData.owner_dept &&
                          !editableOwnerUnits.some((u) => u.unit_name === currentData.owner_dept) && (
                            <option value={currentData.owner_dept}>
                              {currentData.owner_dept} (권한 외)
                            </option>
                          )}
                      </select>
                    ) : (
                      <span className="font-medium text-slate-700 text-[11px] leading-none truncate">
                        {item.owner_dept}
                      </span>
                    )}
                  </div>
                </div>

                {!isEditing && (
                  <>
                    <div className="w-full text-[10px] text-slate-500 font-medium line-clamp-2 bg-slate-50 px-2 py-1.5 rounded">
                      {currentData.description || '상세 설명 없음'}
                    </div>
                    {canShareOwnerDept(item.owner_dept, item.owner_unit_id) && (
                      <div className="w-full flex flex-col gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50/40 p-2">
                        <span className="text-amber-800 font-medium text-[9px]">
                          GLOBAL_MGMT ({globalMgmtDeptLabel}) 권한
                        </span>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-slate-600 font-medium text-[9px]">
                            부서 열람 및 신청 권한
                            {isTopOrgOwnerDept(item.owner_dept) ? ' *' : ''}
                          </span>
                          {(() => {
                            const checkedOpts = viewRoleOptionsFor(item.view_role_ids).filter(
                              ({ id }) =>
                                !REGISTER_VIEW_ROLE_HIDDEN_IDS.has(id) &&
                                isViewRoleChipChecked(id, item.view_role_ids)
                            );
                            if (checkedOpts.length === 0) {
                              return (
                                <span className="px-2 py-1 rounded-md border border-dashed border-slate-200 bg-white text-[9px] font-normal text-slate-400">
                                  미지정
                                </span>
                              );
                            }
                            return checkedOpts.map(({ id, label }) => (
                              <span
                                key={id}
                                className="px-2 py-1 rounded-md border border-amber-500 bg-amber-500 text-white text-[9px] font-medium"
                              >
                                {label}
                              </span>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {isEditing && (
                  <div className="flex flex-col gap-2 mt-1 pt-2 border-t border-slate-100 w-full">
                    <div className="flex flex-col min-w-0">
                      <span className="text-slate-400 font-normal text-[9px] mb-0.5">상세 설명</span>
                      <textarea
                        value={currentData.description || ''}
                        onChange={e=>setEditFormData({...editFormData, description: e.target.value})}
                        className="font-normal text-slate-600 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px] h-12 resize-none w-full"
                      />
                    </div>
                    {canShareOwnerDept(currentData.owner_dept, currentData.owner_unit_id) && (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50/40 p-2">
                        <span className="text-amber-800 font-medium text-[9px]">
                          GLOBAL_MGMT ({globalMgmtDeptLabel}) 권한
                        </span>
                        <span className="text-slate-500 font-normal text-[9px] leading-relaxed">
                          공유 시 「전사 · 신청가능」에 노출. 타부서는 예약 대기, 소유 부서는 즉시 예약.
                        </span>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-slate-600 font-medium text-[9px]">
                            부서 열람 및 신청 권한 지정
                            {isTopOrgOwnerDept(currentData.owner_dept) ? ' *' : ''}
                          </span>
                          {viewRoleOptionsFor(currentData.view_role_ids)
                            .filter(({ id }) => !REGISTER_VIEW_ROLE_HIDDEN_IDS.has(id))
                            .map(({ id, label }) => {
                            const checked = isViewRoleChipChecked(id, currentData.view_role_ids);
                            return (
                              <label
                                key={id}
                                className={`px-2 py-1 rounded-md border text-[9px] font-medium cursor-pointer ${
                                  checked
                                    ? 'bg-amber-500 border-amber-500 text-white'
                                    : 'bg-white border-slate-200 text-slate-500'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={checked}
                                  onChange={(e) => toggleEditViewRole(id, e.target.checked)}
                                />
                                {label}
                              </label>
                            );
                          })}
                          <span className="text-[8px] font-normal text-rose-500">
                            {isTopOrgOwnerDept(currentData.owner_dept)
                              ? '(필수 · 최소 1개 · 저장 시 반영)'
                              : '(선택 · 지정 시 전사·신청가능에 공유 · 저장 시 반영)'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </div>

                {(isEditing || canEditThisItem) && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <button onClick={handleSaveEdit} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-medium text-[10px] shadow-sm hover:bg-emerald-700">💾 저장</button>
                        <button onClick={() => setEditingId(null)} className="px-4 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-medium text-[10px] hover:bg-slate-200">취소</button>
                      </>
                    ) : (
                      <>
                        {/* TODO(restore): 활성 물품 리스트 입고(Edit) — 사용자 요청 시 주석 해제
                        <button
                          onClick={() => {
                            setPurchaseModal(item);
                            setPurchaseForm({
                              qty: '',
                              unit_price: item.unit_price,
                              extra_cost: 0,
                              vendor: '',
                              purchase_date: getKSTDateString(),
                              stock_in_date: getKSTDateString(),
                            });
                          }}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-medium hover:bg-emerald-600 hover:text-white transition-colors"
                        >📦 입고(Edit)</button>
                        */}
                        <button onClick={() => handleOpenEdit(item)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-[10px] font-medium hover:bg-slate-100 transition-colors">✏️ 수정(Edit)</button>

                        {!hasLedger ? (
                          <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-md text-[10px] font-medium hover:bg-red-500 hover:text-white transition-colors">🗑️ 삭제(Edit·신청이력 없음)</button>
                        ) : (
                          <button onClick={() => handleEndItem(item.id)} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[10px] font-medium hover:bg-black transition-colors">🛑 종료(Edit)</button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
      
              {!isEditing && (
                <div className="w-full sm:w-28 shrink-0 flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-slate-100 pt-4 sm:pt-0 sm:pl-4 mt-3 sm:mt-0">
                  <button 
                    onClick={() => openReserveModal(item, needsApprovalRequest)}
                    disabled={!canDistribute || item.current_stock <= 0}
                    className={`w-full py-3.5 rounded-2xl text-[11px] font-medium shadow-md transition-all flex flex-col items-center justify-center gap-0.5
                      ${
                        !inStock
                          ? 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'
                          : needsApprovalRequest
                            ? 'bg-amber-500 text-white hover:bg-amber-600 active:scale-95'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
                      }`}
                  >
                    <span>
                      {!canDistribute
                        ? '신청 불가능'
                        : item.current_stock <= 0
                          ? '품절 (Sold Out)'
                          : needsApprovalRequest
                            ? '예약 대기'
                            : '재고 예약하기'}
                    </span>
                    {inStock && (
                      <span className="text-[9px] font-medium opacity-70">
                        {needsApprovalRequest ? '확정 후 예약 완료' : '즉시 예약 확정'}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 수정 중일 때만 단일 file input (공유 ref 버그 방지) */}
      {editingId && (
        <input type="file" ref={editFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, true)} />
      )}
      
      {filteredActiveItems.length === 0 && (
        <div className="py-20 text-center font-medium text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-[2rem]">
          조건에 맞는 활성 물품이 없습니다.
        </div>
      )}
      
      {purchaseModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overscroll-none"
          onMouseDown={(e) => {
            purchaseBackdropDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (purchaseBackdropDownRef.current && e.target === e.currentTarget) {
              setPurchaseModal(null);
            }
            purchaseBackdropDownRef.current = false;
          }}
        >
          <div className="bg-white w-[550px] max-w-[95vw] border border-slate-200 shadow-2xl p-8 rounded-2xl" onMouseDown={e => e.stopPropagation()}>
            <h4 className="text-[14px] font-black text-slate-900 uppercase tracking-widest mb-4 border-b-2 border-slate-900 pb-3">
              📦 기념품 실물 창고 입고 처리
            </h4>
            <div className="bg-slate-100 p-3 rounded-lg mb-6 flex justify-between items-center">
              <span className="font-black text-indigo-700 text-xs">{purchaseModal.name}</span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">{purchaseModal.id}</span>
            </div>

            <form onSubmit={handlePurchaseSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1.5">구입 일자</label>
                  <input
                    type="date"
                    required
                    value={purchaseForm.purchase_date}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, purchase_date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500 text-slate-600"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1.5">창고 입고 일자</label>
                  <input
                    type="date"
                    required
                    value={purchaseForm.stock_in_date}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, stock_in_date: e.target.value })}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500 text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1.5">구입처 (벤더/업체명)</label>
                <input
                  type="text"
                  required
                  value={purchaseForm.vendor}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, vendor: e.target.value })}
                  placeholder="예: 드림디포, 아트로릭, 한생미디어 등"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500"
                />
              </div>

              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-emerald-600 block mb-1.5">입고 수량 (+)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        required
                        min="1"
                        value={purchaseForm.qty}
                        onChange={(e) =>
                          setPurchaseForm({
                            ...purchaseForm,
                            qty: e.target.value === '' ? '' : Number(e.target.value),
                          })
                        }
                        className="w-full p-2.5 bg-white border-2 border-emerald-400 rounded-lg text-[11px] font-black text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-200 text-right shadow-sm"
                      />
                      <span className="text-[12px] font-black text-emerald-700 shrink-0 min-w-[24px]">
                        {purchaseModal.unit || 'EA'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 block mb-1.5">물품 단가(개당)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      readOnly
                      title="단가가 다르면 신규 기념품으로 등록해 주세요."
                      value={purchaseForm.unit_price}
                      className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-bold outline-none cursor-not-allowed opacity-80 text-right"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-orange-600 block mb-1.5">
                    부대비용 (배송비, 인쇄비, 세금 등 전체 금액)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={purchaseForm.extra_cost}
                    onChange={(e) =>
                      setPurchaseForm({
                        ...purchaseForm,
                        extra_cost: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className="w-full p-2.5 bg-white border border-orange-300 rounded-lg text-[11px] font-bold outline-none focus:border-orange-500 text-right"
                    placeholder="발생하지 않았다면 0"
                  />
                </div>
              </div>

              <div className="pt-2">
                <div className="flex justify-between items-center bg-slate-800 text-white p-4 rounded-xl shadow-inner">
                  <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">결산 총 입고 비용</span>
                  <span className="text-lg font-black">
                    {(
                      (Number(purchaseForm.qty) || 0) * (Number(purchaseForm.unit_price) || 0) +
                      (Number(purchaseForm.extra_cost) || 0)
                    ).toLocaleString()}{' '}
                    <span className="text-[11px] font-medium ml-0.5">원</span>
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPurchaseModal(null)}
                  className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-emerald-700 flex justify-center items-center gap-2"
                >
                  <span>📥</span> 서버 DB 입고 승인
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reserveModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overscroll-none"
          onMouseDown={(e) => {
            reserveBackdropDownRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (reserveBackdropDownRef.current && e.target === e.currentTarget) {
              setReserveModal(null);
            }
            reserveBackdropDownRef.current = false;
          }}
        >
          <div
            className="bg-white w-[400px] max-w-[95vw] border border-slate-200 shadow-2xl p-7 rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className="text-[14px] font-black text-slate-900 tracking-tight mb-1">
              {reserveModal.needsApproval ? '예약 대기' : '재고 예약'}
            </h4>
            <p className="text-[11px] font-bold text-slate-400 mb-5">
              수량을 입력한 뒤 등록하면 「재고 예약」 이력에 반영됩니다.
            </p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-3 mb-5 space-y-1">
              <div className="text-sm font-black text-slate-800 truncate">{reserveModal.item.name}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-slate-500">
                <span>{reserveModal.item.owner_dept || '-'}</span>
                <span>
                  재고 {reserveModal.item.current_stock}
                  {reserveModal.item.unit || 'EA'}
                </span>
              </div>
            </div>
            <form onSubmit={handleReserveSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-indigo-600 uppercase block mb-1.5 ml-0.5">
                  지급 개수 *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={Number(reserveModal.item.current_stock) || 1}
                    required
                    autoFocus
                    value={reserveQty}
                    onChange={(e) =>
                      setReserveQty(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full h-11 px-3 pr-16 bg-white border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">
                    / {reserveModal.item.current_stock || 0}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1.5 ml-0.5">
                  비고 (사용 목적 / 배포처 등)
                </label>
                <input
                  type="text"
                  value={reservePurpose}
                  onChange={(e) => setReservePurpose(e.target.value)}
                  maxLength={200}
                  placeholder="예: 고객사 방문 기념품 / ○○기업"
                  className="w-full h-11 px-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400"
                />
              </div>
              {reserveModal.needsApproval && (
                <p className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  타부서 공유 물품입니다. 등록 시 예약 대기로 접수되며 재고는 즉시 예약(차감)됩니다.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={reserveSaving}
                  onClick={() => setReserveModal(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={reserveSaving}
                  className={`flex-[2] py-3 text-white rounded-xl font-black text-[12px] shadow-md disabled:opacity-50 ${
                    reserveModal.needsApproval
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {reserveSaving
                    ? '처리 중…'
                    : reserveModal.needsApproval
                      ? '예약 대기 등록'
                      : '재고 예약 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
    </div>
  );
}

export default function CatalogModule() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CatalogContent />
    </Suspense>
  );
}
