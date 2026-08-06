'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 
import { getKSTDateString } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept, canEditTopOrgMarketingAsset, isGlobalMgmtOrgMember, canApplyViaViewRoles } from '@/utils/orgUnits';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
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
  const s = String(r ?? '').trim();
  const m = s.match(/(\d+)/);
  return m ? `LV_${m[1]}` : s;
}

function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
      
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
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
  /** APPLICABLE = 신청가능만 / 그 외 = owner_dept 이름 (전체보기 없음) */
  const [selectedDept, setSelectedDept] = useState<string>('APPLICABLE');
      
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
      
  const initialForm = {
    name: '',
    unit_price: '' as string | number,
    extra_cost: '' as string | number,
    current_stock: '' as string | number,
    alert_qty: '' as string | number,
    owner_dept: '',
    description: '',
    image_url: '',
    owner_type: 'CENTER',
    unit: 'EA',
    view_role_ids: [] as string[],
    view_allow_apply: false,
  };
  const [formData, setFormData] = useState(initialForm);
      
  useEffect(() => {
    const deptFromUrl = searchParams.get('dept');
    const searchFromUrl = searchParams.get('search');
    if (deptFromUrl) setSelectedDept(deptFromUrl);
    if (searchFromUrl) setSearchQuery(searchFromUrl);
  }, [searchParams]);
      
  useEffect(() => { fetchData(); }, []);
      
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
        fetch('/api/marketing/distributions?t=' + ts),
        fetch('/api/marketing/purchases?t=' + ts),
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
      if (dRes.ok) setDistributions(await dRes.json());
      else setDistributions([]);
      if (pRes.ok) setPurchases(await pRes.json());
      else setPurchases([]);
      
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

  const checkEditPermission = (itemOwnerDept: string) => {
    if (!currentUser || !systemConfig) return false;
    if (!editState.isEditor) return false;

    const myCenter = currentUser.unit?.unit_name;
    const myHq = currentUser.unit?.parent?.unit_name;
    const globalMgmtDept = systemConfig.global_mgmt_dept;

    // Organization 자산 CRUD → GLOBAL_MGMT만 (TOTAL이어도 동일)
    if (topOrgName && itemOwnerDept === topOrgName) {
      return canEditTopOrgMarketingAsset({
        ownerDept: itemOwnerDept,
        topOrgName,
        myUnitName: myCenter,
        myHqName: myHq,
        globalMgmtDept,
        units,
      });
    }

    // assertCanEditOwnerDept와 동일: TOTAL 전체 / OWN·DEPT는 본인 센터만
    const scope = editState.editScope;
    if (scope === 'TOTAL') return true;
    if ((scope === 'DEPT' || scope === 'OWN') && itemOwnerDept === myCenter) return true;
    return false;
  };

  /**
   * 지급 신청(버튼):
   * Center → 본인+상위HQ+최상위 / HQ → 본인+하위Center+최상위 / Organization → 최상위만
   * LV_1만 전체. (목록 열람은 아랫줄 타 부서로 LV 무관)
   */
  const checkDistributePermission = (item: { owner_dept?: string | null; view_role_ids?: unknown; view_allow_apply?: boolean | null }) => {
    if (!currentUser) return false;
    if (
      canDistributeMarketingOwnerDept(item.owner_dept, {
        myUnitName: currentUser.unit?.unit_name,
        myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
        myHqName: currentUser.unit?.parent?.unit_name,
        topOrgName,
        units,
        isPower: isLv1,
      })
    ) {
      return true;
    }
    return canApplyViaViewRoles(item, currentUser.roles);
  };

  /** 등록/수정 시 선택 가능한 owner_dept (편집 스코프 내만) */
  const editableOwnerUnits = useMemo(() => {
    return units.filter((u) => u?.unit_name && checkEditPermission(u.unit_name));
  }, [units, currentUser, systemConfig, topOrgName, editState.isEditor, editState.editScope]);

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

  const toggleFormViewRole = (lv: string, checked: boolean) => {
    setFormData((prev) => {
      const cur = Array.isArray(prev.view_role_ids) ? prev.view_role_ids : [];
      const next = checked ? Array.from(new Set([...cur, lv])) : cur.filter((r) => r !== lv);
      return {
        ...prev,
        view_role_ids: next,
        view_allow_apply: next.length > 0 ? prev.view_allow_apply : false,
      };
    });
  };

  const toggleEditViewRole = (lv: string, checked: boolean) => {
    setEditFormData((prev: any) => {
      const cur = Array.isArray(prev.view_role_ids) ? prev.view_role_ids.map(normalizeRoleId) : [];
      const next = checked ? Array.from(new Set([...cur, lv])) : cur.filter((r: string) => r !== lv);
      return {
        ...prev,
        view_role_ids: next,
        view_allow_apply: next.length > 0 ? prev.view_allow_apply : false,
      };
    });
  };

  /** 지급 신청 이력만 — 입고만 있으면 삭제 가능(입고도 함께 삭제) */
  const itemHasDistLedger = (itemId: string) => {
    return distributions.some(d => d.item_id === itemId || d.item?.id === itemId);
  };

  const purchaseCountForItem = (itemId: string) => {
    return purchases.filter(p => p.item_id === itemId || p.item?.id === itemId).length;
  };
      
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
    const extraCost = Number(formData.extra_cost) || 0;
    if (extraCost < 0) return alert('부대비용은 0 이상이어야 합니다.');
    const { view_role_ids, view_allow_apply, ...rest } = formData;
    const basePayload = canSetViewRoles
      ? { ...formData, creator_name: currentUser?.name || null, creator_dept: currentUser?.unit?.unit_name || null }
      : { ...rest, creator_name: currentUser?.name || null, creator_dept: currentUser?.unit?.unit_name || null };
    const payload = {
      ...basePayload,
      unit_price: Number(formData.unit_price) || 0,
      extra_cost: extraCost,
      current_stock: Number(formData.current_stock) || 0,
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
      view_allow_apply: !!item.view_allow_apply && roles.length > 0,
    });
  };
      
  const handleSaveEdit = async () => {
    try {
      // 재고(current_stock)는 입고/지급 API로만 변경 — 직접 PATCH 제외
      const {
        current_stock: _omitStock,
        view_role_ids,
        view_allow_apply,
        unit_price,
        unit,
        ...safeEdit
      } = editFormData;
      const lockedByDist = editingId ? itemHasDistLedger(editingId) : false;
      // 열람 LV는 GLOBAL_MGMT만 — 일반 편집자가 alert_qty 등만 저장할 때 403 방지
      let payload: Record<string, unknown> = canSetViewRoles
        ? { ...safeEdit, view_role_ids, view_allow_apply }
        : { ...safeEdit };
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
        '물품 순수 단가는 등록된 단가와 같아야 합니다.\n단가가 변경된 경우 신규 기념품으로 등록해 주세요.'
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
        const go = confirm(
          '입고(재고보충)가 완료되었습니다.\n부서지급대장 > 입고 장부로 이동할까요?'
        );
        if (go) router.push('/marketing/distribution/dept?tab=PURCHASE');
      } else {
        alert(await readApiError(res, '입고 처리에 실패했습니다.'));
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    }
  };
      
  const activeItems = useMemo(() => items.filter(item => !item.is_archived), [items]);

  /** units 정렬 순으로, 활성 물품이 있는 부서만 */
  const availableDepts = useMemo(() => {
    const activeDeptsInItems = new Set(activeItems.map(i => i.owner_dept).filter(Boolean) as string[]);
    const ordered: string[] = [];
    units.forEach(u => {
      if (u.unit_name && activeDeptsInItems.has(u.unit_name) && !ordered.includes(u.unit_name)) {
        ordered.push(u.unit_name);
      }
    });
    activeDeptsInItems.forEach(d => {
      if (!ordered.includes(d)) ordered.push(d);
    });
    return ordered;
  }, [activeItems, units]);

  /**
   * 윗줄(신청가능): 지급신청 가능한 물품이 1건이라도 있는 부서
   * (소속 범위 + GLOBAL_MGMT 신청허용 포함 — 같은 부서가 위·아래로 쪼개지지 않음)
   */
  const primaryDepts = useMemo(() => {
    const names = new Set<string>();
    for (const item of activeItems) {
      if (item.owner_dept && checkDistributePermission(item)) {
        names.add(item.owner_dept);
      }
    }
    const ordered: string[] = [];
    units.forEach((u) => {
      if (u.unit_name && names.has(u.unit_name) && !ordered.includes(u.unit_name)) {
        ordered.push(u.unit_name);
      }
    });
    names.forEach((n) => {
      if (!ordered.includes(n)) ordered.push(n);
    });
    return ordered;
  }, [activeItems, currentUser, topOrgName, units, isLv1]);

  /** 아랫줄(신청 불가능·열람): 신청 가능 물품이 없는 타 부서 */
  const otherDepts = useMemo(
    () => availableDepts.filter((d) => !primaryDepts.includes(d)),
    [availableDepts, primaryDepts]
  );

  const applicableCount = useMemo(
    () => activeItems.filter((i) => checkDistributePermission(i)).length,
    [activeItems, currentUser, topOrgName, units, isLv1]
  );

  const filteredActiveItems = useMemo(() => {
    return activeItems.filter(item => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept =
        selectedDept === 'APPLICABLE'
          ? checkDistributePermission(item)
          : item.owner_dept === selectedDept;
      return matchSearch && matchDept;
    });
  }, [activeItems, searchQuery, selectedDept, currentUser, topOrgName, units, isLv1]);
      
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
            마케팅 카탈로그 쇼룸
          </h1>
          <p className="text-white/70 text-xs mt-3 leading-relaxed">
            활성 기념품을 확인하고 등록합니다. 지급 신청으로 재고를 확보하세요. (입고·수정·마감은 소속 부서만)
          </p>
          {permissionSummary && (
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
              {!canSeeAddForm && (
                <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
                  편집 권한 없음 — 조회·지급신청만 가능
                </span>
              )}
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

            <div className="flex-1 w-full grid grid-cols-2 lg:grid-cols-8 gap-2.5">
              <input required placeholder="물품명 *" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 focus:bg-white transition-all" />
              <select required value={formData.owner_dept} onChange={e=>setFormData({...formData, owner_dept: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all">
                <option value="">관리 조직 선택 *</option>
                {editableOwnerUnits.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
              <input type="number" min="0" placeholder="물품 순수 단가(원)" value={formData.unit_price ?? ''} onChange={e=>setFormData({...formData, unit_price: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="개당 순수 단가 (부대비용 제외)" />
              <input type="number" min="0" placeholder="부대비용(원)" value={formData.extra_cost ?? ''} onChange={e=>setFormData({...formData, extra_cost: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-orange-200 rounded-xl outline-none focus:ring-2 ring-orange-400 transition-all" title="배송비, 인쇄비, 세금 등 (없으면 0)" />
              <input type="number" min="0" placeholder="초기수량" value={formData.current_stock ?? ''} onChange={e=>setFormData({...formData, current_stock: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" min="0" placeholder="재고확보기준수량" value={formData.alert_qty ?? ''} onChange={e=>setFormData({...formData, alert_qty: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="이 수량 이하로 떨어지면 알림이 뜹니다." />
              <select value={formData.unit || ''} onChange={e=>setFormData({...formData, unit: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all cursor-pointer">
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
            </div>

            <button type="submit" className="w-full lg:w-24 shrink-0 h-10 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95">신규등록</button>
          </form>
          {canSetViewRoles && (
            <div className="mt-3 px-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-tight">타부서 열람 레벨</span>
              <span className="text-[9px] font-bold text-slate-400">
                (미지정=타부서 열람 불가 / 열람 레벨 각 지정필요: LV_1(운영관리자), LV_2(센터장 이상), LV_3(일반 직원))
              </span>
              {['LV_1', 'LV_2', 'LV_3'].map((lv) => {
                const checked = (formData.view_role_ids || []).includes(lv);
                return (
                  <label
                    key={lv}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] font-black cursor-pointer transition-all ${
                      checked
                        ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={checked}
                      onChange={(e) => toggleFormViewRole(lv, e.target.checked)}
                    />
                    {lv}
                  </label>
                );
              })}
              <label
                className={`ml-1 px-2.5 py-1 rounded-lg border text-[10px] font-black cursor-pointer transition-all ${
                  formData.view_allow_apply && (formData.view_role_ids || []).length > 0
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300'
                } ${(formData.view_role_ids || []).length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                title="열람 LV를 먼저 지정해야 신청 허용을 켤 수 있습니다"
              >
                <input
                  type="checkbox"
                  className="hidden"
                  disabled={(formData.view_role_ids || []).length === 0}
                  checked={!!formData.view_allow_apply && (formData.view_role_ids || []).length > 0}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      view_allow_apply: e.target.checked && (prev.view_role_ids || []).length > 0,
                    }))
                  }
                />
                지정 LV 신청 허용
              </label>
            </div>
          )}
        </div>
      )}
      
      <div className="flex justify-between items-end pl-2 mt-8 gap-4 flex-wrap">
        <h3 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <span>🛍️</span> 활성 물품 리스트
        </h3>
      </div>
      
      <div className="bg-slate-100 p-5 rounded-[2rem] border border-slate-200 shadow-inner flex flex-col gap-4 mt-2 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            {/* 윗줄: 신청가능 + 내 소속/상위HQ 또는 하위센터 */}
            <div>
              <div className="text-[9px] font-black text-indigo-500 uppercase tracking-wider mb-1.5 px-0.5">
                신청가능
              </div>
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedDept('APPLICABLE')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${
                    selectedDept === 'APPLICABLE'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                      : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50 shadow-sm'
                  }`}
                >
                  신청가능보기 ({applicableCount})
                </button>
                {primaryDepts.map((dept) => {
                  const count = activeItems.filter((i) => i.owner_dept === dept).length;
                  const selected = selectedDept === dept;
                  return (
                    <button
                      key={`p-${dept}`}
                      type="button"
                      onClick={() => setSelectedDept(dept)}
                      title={`${dept} 보유 물품 ${count}개`}
                      className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-white text-slate-900 border-slate-200 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      {dept}
                      <span className={selected ? 'text-indigo-200 mx-0.5' : 'text-slate-400 mx-0.5'}>
                        ·
                      </span>
                      <span className={selected ? 'text-indigo-100 font-mono' : 'text-slate-600 font-mono'}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 아랫줄: 타 부서 (units order) */}
            {otherDepts.length > 0 && (
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">타 부서 물품 열람(신청 불가능)</div>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                  {otherDepts.map((dept) => {
                    const count = activeItems.filter((i) => i.owner_dept === dept).length;
                    const selected = selectedDept === dept;
                    return (
                      <button
                        key={`o-${dept}`}
                        type="button"
                        onClick={() => setSelectedDept(dept)}
                        title={`${dept} 보유 물품 ${count}개`}
                        className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${
                          selected
                            ? 'bg-slate-500 text-white border-slate-500 shadow-sm'
                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200/80'
                        }`}
                      >
                        {dept}
                        <span className={selected ? 'text-slate-300 mx-0.5' : 'text-slate-300 mx-0.5'}>
                          ·
                        </span>
                        <span className={selected ? 'text-slate-200 font-mono' : 'text-slate-400 font-mono'}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="relative w-full lg:w-80 shrink-0">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="물품명 통합 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 shadow-sm transition-all"
            />
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredActiveItems.map(item => {
          const isEditing = editingId === item.id;
          const currentData = isEditing ? editFormData : item;
          const canDistribute = checkDistributePermission(item);
          const canEditThisItem = checkEditPermission(item.owner_dept);
          
          const currentUnit = currentData.unit || 'EA';
          const hasLedger = itemHasDistLedger(item.id);
          const inStock = canDistribute && item.current_stock > 0;
          const isTopOrgItem = !!(topOrgName && item.owner_dept === topOrgName);
          const viaOwner = canDistributeMarketingOwnerDept(item.owner_dept, {
            myUnitName: currentUser?.unit?.unit_name,
            myUnitId: currentUser?.dept_id || currentUser?.unit_id || currentUser?.unit?.id,
            myHqName: currentUser?.unit?.parent?.unit_name,
            topOrgName,
            units,
            isPower: isLv1,
          });
          const viaViewApply = canApplyViaViewRoles(item, currentUser?.roles);
          // Organization 풀 · 열람LV 신청허용(타부서) → 승인 요청(앰버). 승인 단계는 지급대장에서 예정
          const needsApprovalRequest = inStock && (isTopOrgItem || (viaViewApply && !viaOwner));
      
          return (
            <div key={item.id} className={`flex flex-col sm:flex-row p-6 bg-white border rounded-[2rem] transition-all shadow-sm relative group ${isEditing ? 'border-indigo-500 ring-4 ring-indigo-50 z-50' : 'border-slate-200 hover:shadow-md'}`}>
              
              <div 
                onClick={() => isEditing && editFileInputRef.current?.click()}
                className={`w-full sm:w-36 h-36 shrink-0 bg-slate-50 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-100 relative ${isEditing ? 'cursor-pointer' : ''}`}
              >
                {currentData.image_url ? (
                  <img src={currentData.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="img" />
                ) : <span className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No Image</span>}
                
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white font-black text-xs animate-in fade-in gap-0.5 px-2 text-center">
                    <span>📸 사진 변경</span>
                    <span className="text-[9px] font-bold opacity-80">≤{MAX_IMAGE_LABEL}</span>
                  </div>
                )}
                
                {!isEditing &&
                  canDistribute &&
                  currentData.alert_qty > 0 &&
                  currentData.current_stock <= currentData.alert_qty && (
                  <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded-lg text-[9px] font-black animate-pulse shadow-sm">
                    🚨 재고 부족!
                  </div>
                )}
              </div>
      
              <div className="flex-1 flex flex-col justify-between sm:ml-6 mt-4 sm:mt-0">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    {isEditing ? (
                      <input value={currentData.name} onChange={e=>setEditFormData({...editFormData, name: e.target.value})} className="w-full font-black text-lg text-blue-600 bg-blue-50 px-2 py-1 rounded outline-none border-b border-blue-200" />
                    ) : (
                      <h4 className={`text-lg font-black line-clamp-1 ${canDistribute ? 'text-slate-900' : 'text-slate-400'}`}>{currentData.name}</h4>
                    )}
                    {!isEditing && (
                      <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                        <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border whitespace-nowrap ${canDistribute ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                          {item.owner_dept}
                        </span>
                        {Array.isArray(item.view_role_ids) && item.view_role_ids.length > 0 && (
                          <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                            열람 {item.view_role_ids.map(normalizeRoleId).join(', ')}
                            {item.view_allow_apply ? ' · 신청허용' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
        
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">
                        물품 순수 단가(원)
                        {isEditing && hasLedger && (
                          <span className="text-amber-600 font-black ml-1 normal-case">
                            — 지급이력 있음, 단가변경 불가
                          </span>
                        )}
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
                          className={`font-mono font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 ${
                            hasLedger ? 'cursor-not-allowed opacity-60' : ''
                          }`}
                        />
                      ) : canDistribute ? (
                        <span className="font-mono font-black text-slate-700 text-sm">
                          {Number(currentData.unit_price || 0).toLocaleString()}{' '}
                          <span className="text-[9px] font-bold">KRW</span>
                        </span>
                      ) : (
                        <span className="font-mono font-black text-slate-400 text-sm">-</span>
                      )}
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">재고 {isEditing && <span className="text-amber-500">(입고로만 변경)</span>}</span>
                      <span
                        className={`font-mono font-black text-sm ${
                          !canDistribute
                            ? 'text-slate-400'
                            : currentData.current_stock <= (currentData.alert_qty || 0) &&
                                currentData.alert_qty > 0
                              ? 'text-red-500'
                              : 'text-indigo-600'
                        }`}
                      >
                        {currentData.current_stock}{' '}
                        <span className="text-[10px] font-bold pl-1">{currentUnit}</span>
                      </span>
                    </div>
                  </div>
      
                  {!isEditing && (
                    <div className="text-[10px] text-slate-500 font-medium line-clamp-1 bg-slate-50 p-1.5 rounded">
                      {currentData.description || '상세 설명 없음'}
                    </div>
                  )}
      
                  {isEditing && (
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100">
                      <div className="flex flex-col">
                        <span className="text-red-400 font-bold text-[9px] mb-0.5">재고확보 기준수량</span>
                        <input type="number" value={currentData.alert_qty} onChange={e=>setEditFormData({...editFormData, alert_qty: Number(e.target.value)})} className="font-mono font-black text-red-600 bg-red-50 p-1.5 rounded outline-none border border-red-100 text-[10px]" />
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">
                          물품 단위
                          {hasLedger && (
                            <span className="text-amber-600 font-black ml-1">
                              — 지급이력 있음, 단위변경 불가
                            </span>
                          )}
                        </span>
                        <select
                          disabled={hasLedger}
                          title={
                            hasLedger
                              ? '지급 신청 이력이 있어 단위를 변경할 수 없습니다. 단위가 바뀐 상품은 신규 등록해 주세요.'
                              : undefined
                          }
                          value={currentData.unit || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, unit: e.target.value })}
                          className={`font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px] w-full ${
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
                      </div>
      
                      <div className="col-span-2 flex flex-col">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">부서 변경</span>
                        <select value={currentData.owner_dept} onChange={e=>setEditFormData({...editFormData, owner_dept: e.target.value})} className="font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px]">
                          {editableOwnerUnits.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
                          {currentData.owner_dept && !editableOwnerUnits.some((u) => u.unit_name === currentData.owner_dept) && (
                            <option value={currentData.owner_dept}>{currentData.owner_dept} (권한 외)</option>
                          )}
                        </select>
                      </div>
                      
                      <div className="col-span-2 flex flex-col mt-1">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">상세 설명</span>
                        <textarea 
                          value={currentData.description || ''} 
                          onChange={e=>setEditFormData({...editFormData, description: e.target.value})} 
                          className="font-bold text-slate-600 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px] h-12 resize-none" 
                        />
                      </div>
                      {canSetViewRoles && (
                        <div className="col-span-2 flex flex-col mt-1 gap-1.5">
                          <span className="text-amber-600 font-bold text-[9px]">
                            타부서 열람 레벨 (미지정=타부서 숨김, 열람레벨 각 설정(LV_1,2=센터장 이상 조회)
                          </span>
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {['LV_1', 'LV_2', 'LV_3'].map((lv) => {
                              const roles = Array.isArray(currentData.view_role_ids)
                                ? currentData.view_role_ids.map(normalizeRoleId)
                                : [];
                              const checked = roles.includes(lv);
                              return (
                                <label
                                  key={lv}
                                  className={`px-2 py-1 rounded-md border text-[9px] font-black cursor-pointer ${
                                    checked
                                      ? 'bg-amber-500 border-amber-500 text-white'
                                      : 'bg-white border-slate-200 text-slate-500'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={checked}
                                    onChange={(e) => toggleEditViewRole(lv, e.target.checked)}
                                  />
                                  {lv}
                                </label>
                              );
                            })}
                            <label
                              className={`px-2 py-1 rounded-md border text-[9px] font-black cursor-pointer ${
                                currentData.view_allow_apply &&
                                Array.isArray(currentData.view_role_ids) &&
                                currentData.view_role_ids.length > 0
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-slate-200 text-slate-500'
                              } ${
                                !Array.isArray(currentData.view_role_ids) ||
                                currentData.view_role_ids.length === 0
                                  ? 'opacity-40 cursor-not-allowed'
                                  : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="hidden"
                                disabled={
                                  !Array.isArray(currentData.view_role_ids) ||
                                  currentData.view_role_ids.length === 0
                                }
                                checked={
                                  !!currentData.view_allow_apply &&
                                  Array.isArray(currentData.view_role_ids) &&
                                  currentData.view_role_ids.length > 0
                                }
                                onChange={(e) =>
                                  setEditFormData((prev: any) => ({
                                    ...prev,
                                    view_allow_apply:
                                      e.target.checked &&
                                      Array.isArray(prev.view_role_ids) &&
                                      prev.view_role_ids.length > 0,
                                  }))
                                }
                              />
                              지정 LV 신청 허용
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
      
                <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2">
                  {isEditing ? (
                    <>
                      <button onClick={handleSaveEdit} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-black text-[10px] shadow-sm hover:bg-emerald-700">💾 저장</button>
                      <button onClick={() => setEditingId(null)} className="px-4 py-1.5 bg-slate-100 text-slate-500 rounded-lg font-black text-[10px] hover:bg-slate-200">취소</button>
                    </>
                  ) : (
                    canEditThisItem && (
                      <>
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
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-black hover:bg-emerald-600 hover:text-white transition-colors"
                        >📦 입고</button>
                        <button onClick={() => handleOpenEdit(item)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-[10px] font-black hover:bg-slate-100 transition-colors">✏️ 수정</button>
                        
                        {!hasLedger ? (
                          <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors">🗑️ 삭제(신청이력X)</button>
                        ) : (
                          <button onClick={() => handleEndItem(item.id)} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[10px] font-black hover:bg-black transition-colors">🛑 종료(마감)</button>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>
      
              {!isEditing && (
                <div className="w-full sm:w-36 shrink-0 flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-slate-100 pt-5 sm:pt-0 sm:pl-6 mt-4 sm:mt-0">
                  <button 
                    onClick={() => router.push(`/marketing/distribution/register?itemId=${item.id}`)}
                    disabled={!canDistribute || item.current_stock <= 0}
                    className={`w-full py-4 rounded-2xl text-[12px] font-black shadow-md transition-all flex flex-col items-center justify-center gap-1
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
                            ? '승인 요청하기'
                            : '지급 신청하기'}
                    </span>
                    {inStock && (
                      <span className="text-[9px] font-medium opacity-70">
                        {needsApprovalRequest ? '클릭 시 요청 폼 이동' : '클릭 시 폼 이동'}
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
        <div className="py-20 text-center font-black text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-[2rem]">
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
                    <label className="text-[10px] font-black text-slate-500 block mb-1.5">물품 순수 단가(개당)</label>
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
