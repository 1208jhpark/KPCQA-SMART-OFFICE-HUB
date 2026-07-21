'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 
import { getKSTDateString } from '@/utils/dateUtils';
import { resolveTopOrgName, canDistributeMarketingOwnerDept, canEditTopOrgMarketingAsset, getChildUnitNames } from '@/utils/orgUnits';

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
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
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
    vendor: '',
    note: '',
    purchase_date: getKSTDateString()
  });
  /** 모달 안에서 텍스트 드래그 후 배경에서 mouseup 시 닫히는 것 방지 */
  const purchaseBackdropDownRef = useRef(false);
      
  const initialForm = { name: '', unit_price: '', current_stock: '', alert_qty: '', owner_dept: '', description: '', image_url: '', owner_type: 'CENTER', unit: 'EA' };
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
      const [iRes, uRes, meRes, ifRes, sysRes, masterRes, dRes, pRes] = await Promise.all([
        fetch('/api/marketing/items?t=' + ts),
        fetch('/api/admin/units?active=true&t=' + ts),
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/master-data?t=' + ts),
        fetch('/api/marketing/distributions?t=' + ts),
        fetch('/api/marketing/purchases?t=' + ts)
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
        const config = interfaces.find((m: any) => m.path === '/marketing/distribution/catalog');
        setInterfaceConfig(config);
      }
      
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

  const canSeeAddForm = useMemo(() => {
    if (!currentUser || !interfaceConfig) return false;
    if (isLv1) return true;

    const myId = currentUser.id;
    const eRoles = safeArray(interfaceConfig.edit_role_ids).map(normalizeRoleId);
    const tMasters = safeArray(interfaceConfig.task_masters);

    if (interfaceConfig.master_editor_id === myId) return true;
    if (myRoles.some((r) => eRoles.includes(r))) return true;
    if (tMasters.some((tm: any) => emailsEqual(tm.email, currentUser.email))) return true;
    return false;
  }, [currentUser, interfaceConfig, isLv1, myRoles]);

  const checkEditPermission = (itemOwnerDept: string) => {
    if (!currentUser || !interfaceConfig || !systemConfig) return false;
    if (isLv1) return true;
    if (interfaceConfig.master_editor_id === currentUser.id) return true;
    if (!canSeeAddForm) return false;

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
      });
    }

    const eScopes = safeArray(interfaceConfig.edit_scopes);
    if (eScopes.includes('TOTAL') || eScopes.length === 0) return true;
    if (eScopes.includes('DEPT')) {
      // 본인 소속만 CRUD (상위 HQ·하위 센터는 신청만)
      if (itemOwnerDept === myCenter) return true;
    }
    return false;
  };

  /**
   * 지급 신청(버튼):
   * Center → 본인+상위HQ+최상위 / HQ → 본인+하위Center+최상위 / Organization → 최상위만
   * LV_1만 전체. (목록 열람은 아랫줄 타 부서로 LV 무관)
   */
  const checkDistributePermission = (itemOwnerDept: string) => {
    if (!currentUser) return false;
    return canDistributeMarketingOwnerDept(itemOwnerDept, {
      myUnitName: currentUser.unit?.unit_name,
      myUnitId: currentUser.dept_id || currentUser.unit_id || currentUser.unit?.id,
      myHqName: currentUser.unit?.parent?.unit_name,
      topOrgName,
      units,
      isPower: isLv1,
    });
  };

  /** 등록/수정 시 선택 가능한 owner_dept (편집 스코프 내만) */
  const editableOwnerUnits = useMemo(() => {
    return units.filter((u) => u?.unit_name && checkEditPermission(u.unit_name));
  }, [units, currentUser, interfaceConfig, systemConfig, topOrgName, isLv1, canSeeAddForm]);

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
    const res = await fetch('/api/marketing/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        creator_name: currentUser?.name || null,
        creator_dept: currentUser?.unit?.unit_name || null,
      })
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
    setEditFormData({ ...item, unit: item.unit || 'EA' });
  };
      
  const handleSaveEdit = async () => {
    try {
      // 재고(current_stock)는 입고/지급 API로만 변경 — 직접 PATCH 제외
      const { current_stock: _omitStock, ...safeEdit } = editFormData;
      const res = await fetch('/api/marketing/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safeEdit)
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
    const payload = {
      ...purchaseForm,
      qty,
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

  const myDeptName = currentUser?.unit?.unit_name as string | undefined;
  const myHqName = currentUser?.unit?.parent?.unit_name as string | undefined;
  const myUnitId = currentUser?.unit_id || currentUser?.unit?.id;
  const isTopOrgUser = Boolean(topOrgName && myDeptName && myDeptName === topOrgName);

  const childCenterNames = useMemo(
    () => getChildUnitNames(myDeptName, myUnitId, units),
    [myDeptName, myUnitId, units]
  );

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
   * 윗줄: Organization + 소속/상위HQ/하위센터 — 표시 순서는 units(admin) 정렬 유지
   */
  const primaryDepts = useMemo(() => {
    const names = new Set<string>();
    const add = (name?: string | null) => {
      if (name && availableDepts.includes(name)) names.add(name);
    };
    add(topOrgName);
    add(myDeptName);
    if (!isTopOrgUser) {
      if (myHqName && myHqName !== topOrgName) add(myHqName);
      childCenterNames.forEach((c) => add(c));
    }
    // admin/units 순서: Organization → HQ → Center
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
  }, [availableDepts, myDeptName, myHqName, topOrgName, isTopOrgUser, childCenterNames, units]);

  /** 아랫줄: 타 부서 (윗줄에 없는 HQ/Center 등, units order 유지) — LV 무관 전사 열람 */
  const otherDepts = useMemo(
    () => availableDepts.filter((d) => !primaryDepts.includes(d)),
    [availableDepts, primaryDepts]
  );

  const applicableCount = useMemo(
    () => activeItems.filter((i) => checkDistributePermission(i.owner_dept)).length,
    [activeItems, currentUser, topOrgName, units, isLv1]
  );

  const filteredActiveItems = useMemo(() => {
    return activeItems.filter(item => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept =
        selectedDept === 'APPLICABLE'
          ? checkDistributePermission(item.owner_dept)
          : item.owner_dept === selectedDept;
      return matchSearch && matchDept;
    });
  }, [activeItems, searchQuery, selectedDept, currentUser, topOrgName, units, isLv1]);
      
  if (loading) return <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Syncing Hub Master Data...</div>;
      
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
      
      <div className="w-full bg-slate-900 p-8 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden group">
        <div className="absolute right-[-10px] top-[-10px] w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
        <div className="relative z-10 flex justify-between items-end w-full">
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-3">
              MARKETING ASSET CATALOG
            </h3>
            <h1 className="text-2xl font-black tracking-tight text-white leading-none flex items-center gap-3">
              마케팅 카탈로그 쇼룸
            </h1>
            <p className="text-slate-400 text-xs font-semibold mt-4 leading-relaxed">
              현재 활성화된 마케팅/기념품 리스트를 확인하고 신규 물품을 등록하는 통합 카탈로그입니다.<br/>
              <span className="text-rose-300">고객사별 수령현황을 확인 후 "지급 신청하기"로 재고를 확보하세요. (그룹웨어에 별도 신청 필요)</span><br/>
              <span className="text-indigo-300">(※ 윗줄: 신청가능(본인·상위본부/하위센터·최상위) / 아랫줄: 타 부서 열람(LV 무관). 지급 신청은 신청가능 범위만. 최상위 물품 입고·수정·종료는 통합관리부서만.)</span>
            </p>
          </div>
          <div className="hidden md:block">
            <div className="w-12 h-12 rounded-[1rem] bg-white/10 flex items-center justify-center text-xl backdrop-blur-sm border border-white/20 shadow-inner">
              🛍️
            </div>
          </div>
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
              <select required value={formData.owner_dept} onChange={e=>setFormData({...formData, owner_dept: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all">
                <option value="">관리 조직 선택 *</option>
                {editableOwnerUnits.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
              <input type="number" placeholder="단가(원)" value={formData.unit_price} onChange={e=>setFormData({...formData, unit_price: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="초기수량" value={formData.current_stock} onChange={e=>setFormData({...formData, current_stock: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="재고확보기준수량" value={formData.alert_qty} onChange={e=>setFormData({...formData, alert_qty: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="이 수량 이하로 떨어지면 알림이 뜹니다." />
              <select value={formData.unit || ''} onChange={e=>setFormData({...formData, unit: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all cursor-pointer">
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full h-10 px-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
            </div>

            <button type="submit" className="w-full lg:w-24 shrink-0 h-10 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95">신규등록</button>
          </form>
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
              <div className="text-[9px] font-black text-indigo-500 uppercase tracking-wider mb-1.5 px-0.5">신청가능</div>
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
                  return (
                    <button
                      key={`p-${dept}`}
                      type="button"
                      onClick={() => setSelectedDept(dept)}
                      className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${
                        selectedDept === dept
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      {dept} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 아랫줄: 타 부서 (units order) */}
            {otherDepts.length > 0 && (
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">타 부서</div>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                  {otherDepts.map((dept) => {
                    const count = activeItems.filter((i) => i.owner_dept === dept).length;
                    return (
                      <button
                        key={`o-${dept}`}
                        type="button"
                        onClick={() => setSelectedDept(dept)}
                        className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${
                          selectedDept === dept
                            ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 shadow-sm'
                        }`}
                      >
                        {dept} ({count})
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
          const canDistribute = checkDistributePermission(item.owner_dept);
          const canEditThisItem = checkEditPermission(item.owner_dept);
          
          const currentUnit = currentData.unit || 'EA';
          const hasLedger = itemHasDistLedger(item.id);
      
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
                
                {!isEditing && currentData.alert_qty > 0 && currentData.current_stock <= currentData.alert_qty && (
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
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-md ml-2 shrink-0 border whitespace-nowrap ${canDistribute ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                        {item.owner_dept}
                      </span>
                    )}
                  </div>
        
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">단가(원)</span>
                      {isEditing ? (
                         <input type="number" value={currentData.unit_price} onChange={e=>setEditFormData({...editFormData, unit_price: e.target.value})} className="font-mono font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200" />
                      ) : <span className="font-mono font-black text-slate-700 text-sm">{Number(currentData.unit_price || 0).toLocaleString()} <span className="text-[9px] font-bold">KRW</span></span>}
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">재고 {isEditing && <span className="text-amber-500">(입고로만 변경)</span>}</span>
                      <span className={`font-mono font-black text-sm ${currentData.current_stock <= (currentData.alert_qty || 0) && currentData.alert_qty > 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                        {currentData.current_stock} <span className="text-[10px] font-bold pl-1">{currentUnit}</span>
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
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">물품 단위</span>
                        <div onClick={() => { if (hasLedger) alert('⚠️ 지급 신청 이력이 있는 물품의 단위는 수정할 수 없습니다.\n단위가 변경된 상품은 신규 상품으로 등록해 주세요.'); }}>
                          <select 
                            disabled={hasLedger}
                            value={currentData.unit || ''} 
                            onChange={e=>setEditFormData({...editFormData, unit: e.target.value})} 
                            className={`font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px] w-full ${hasLedger ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          >
                            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
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
                          onClick={() => { setPurchaseModal(item); setPurchaseForm({ qty: '', unit_price: item.unit_price, vendor: '', note: '', purchase_date: getKSTDateString() }); }} 
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
                      ${canDistribute && item.current_stock > 0 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95' 
                        : 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'}`}
                  >
                    <span>{canDistribute ? (item.current_stock > 0 ? '지급 신청하기' : '품절 (Sold Out)') : '접근 불가'}</span>
                    {canDistribute && item.current_stock > 0 && <span className="text-[9px] font-medium opacity-70">클릭 시 폼 이동</span>}
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
          <div className="bg-white w-[420px] p-8 rounded-[2rem] shadow-2xl flex flex-col border" onMouseDown={e => e.stopPropagation()}>
            <div className="border-b border-slate-100 pb-4 mb-6">
               <h3 className="font-black text-lg text-slate-900 flex items-center gap-2"><span>📦</span> 신규 재고 입고 (구매)</h3>
               <p className="text-[11px] text-indigo-600 font-bold mt-1">[{purchaseModal.name}] 물품의 재고를 보충합니다.</p>
            </div>
            
            <form onSubmit={handlePurchaseSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-600 uppercase">
                    입고 수량 ({purchaseModal.unit || 'EA'}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="수량 입력"
                    value={purchaseForm.qty}
                    onChange={e => setPurchaseForm({
                      ...purchaseForm,
                      qty: e.target.value === '' ? '' : Number(e.target.value)
                    })}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-600 uppercase">입고 단가(원) *</label>
                  <input required type="number" min="0" value={purchaseForm.unit_price} onChange={e=>setPurchaseForm({...purchaseForm, unit_price: Number(e.target.value)})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white" />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-600 uppercase">입고일자</label>
                  <input required type="date" value={purchaseForm.purchase_date} onChange={e=>setPurchaseForm({...purchaseForm, purchase_date: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-600 uppercase">총 입고 금액</label>
                  <div className="w-full p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs font-mono font-black text-indigo-700 text-right">
                    {((Number(purchaseForm.qty) || 0) * (Number(purchaseForm.unit_price) || 0)).toLocaleString()} 원
                  </div>
                </div>
              </div>
      
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-600 uppercase">구매처/공급업체</label>
                <input type="text" value={purchaseForm.vendor} onChange={e=>setPurchaseForm({...purchaseForm, vendor: e.target.value})} placeholder="예: 한생미디어, 드림디포 등" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white" />
              </div>
      
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-600 uppercase">비고</label>
                <input type="text" value={purchaseForm.note} onChange={e=>setPurchaseForm({...purchaseForm, note: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white" />
              </div>
              
              <div className="flex gap-2.5 pt-4">
                <button type="button" onClick={() => setPurchaseModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[12px] hover:bg-slate-200">취소</button>
                <button type="submit" className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[12px] shadow-lg hover:bg-emerald-700">입고 처리 완료</button>
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
    <Suspense fallback={<div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Loading Catalog Environment...</div>}>
      <CatalogContent />
    </Suspense>
  );
}
