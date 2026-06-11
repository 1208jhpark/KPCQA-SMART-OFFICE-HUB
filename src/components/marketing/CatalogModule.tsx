'use client';
     
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 
import * as XLSX from 'xlsx';
     
function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
     
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [distributions, setDistributions] = useState<any[]>([]); 
  const [currentUser, setCurrentUser] = useState<any>(null); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [unitOptions, setUnitOptions] = useState<string[]>(['EA']);
     
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
     
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  
  const [purchaseModal, setPurchaseModal] = useState<any>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    qty: 0, unit_price: 0, vendor: '', note: '', purchase_date: new Date().toISOString().split('T')[0]
  });
  
  // 🚀 보관함 모달 제어 상태
  const [showArchiveModal, setShowArchiveModal] = useState(false);
     
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
    try {
      const [iRes, uRes, meRes, ifRes, sysRes, masterRes, dRes] = await Promise.all([
        fetch('/api/marketing/items'),
        fetch('/api/admin/units?active=true'),
        fetch('/api/auth/me'),
        fetch('/api/admin/interface'),
        fetch('/api/admin/config'),
        fetch('/api/admin/master-data'),
        fetch('/api/marketing/distributions')
      ]);
      
      let systemConfigData = null;
      if (sysRes.ok) {
        const sysData = await sysRes.json();
        setSystemConfig(sysData);
        systemConfigData = sysData;
      }

      if (iRes.ok) setItems(await iRes.json());
      if (uRes.ok) setUnits(await uRes.json());
      if (dRes.ok) setDistributions(await dRes.json());
      
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
    } catch(e) { console.error("데이터 로드 중 오류:", e); }
    setLoading(false);
  };
     
  const safeArray = (val: any) => {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) || []; } catch(e) { return []; }
  };
     
  const canSeeAddForm = useMemo(() => {
    if (!currentUser || !interfaceConfig) return false;
    if (currentUser.roles?.includes('LV_1')) return true; 
    
    const myRole = currentUser.roles?.[0];
    const myEmail = currentUser.email;
    const myId = currentUser.id;
    const eRoles = safeArray(interfaceConfig.edit_role_ids);
    const tMasters = safeArray(interfaceConfig.task_masters);
    
    if (interfaceConfig.master_editor_id === myId) return true;
    if (eRoles.includes(myRole)) return true;
    if (tMasters.some((tm: any) => tm.email === myEmail)) return true;
    return false;
  }, [currentUser, interfaceConfig]);
     
  const checkEditPermission = (itemOwnerDept: string) => {
    if (!currentUser || !interfaceConfig || !systemConfig) return false;
    if (currentUser.roles?.includes('LV_1')) return true; 
    if (interfaceConfig.master_editor_id === currentUser.id) return true;
    if (!canSeeAddForm) return false;
    
    const eScopes = safeArray(interfaceConfig.edit_scopes);
    if (eScopes.includes('TOTAL') || eScopes.length === 0) return true;
    if (eScopes.includes('DEPT')) {
      const myCenter = currentUser.unit?.unit_name;
      const myHq = currentUser.unit?.parent?.unit_name;
      const globalMgmtDept = systemConfig.global_mgmt_dept;
      if (itemOwnerDept === myCenter || itemOwnerDept === myHq) return true;
      if (itemOwnerDept === 'KPCQA') {
        if (myCenter === globalMgmtDept || myHq === globalMgmtDept) return true;
      }
    }
    return false;
  };
     
  const checkDistributePermission = (itemOwnerDept: string) => {
    if (!currentUser || !currentUser.unit) return false;
    if (currentUser.roles?.includes('LV_1')) return true; 
    
    const myCenter = currentUser.unit.unit_name;
    const myHq = currentUser.unit.parent?.unit_name;
    const company = "KPCQA";
    return itemOwnerDept === myCenter || itemOwnerDept === myHq || itemOwnerDept === company;
  };
     
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (isEdit) setEditFormData({ ...editFormData, image_url: evt.target?.result as string });
        else setFormData({ ...formData, image_url: evt.target?.result as string });
      };
      reader.readAsDataURL(file);
    }
  };
     
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.owner_dept) return alert("물품명과 조직은 필수입니다.");
    const res = await fetch('/api/marketing/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    if (res.ok) {
      alert('신규 물품이 등록되었습니다.');
      setFormData({ ...initialForm, unit: unitOptions[0] || 'EA' });
      fetchData();
    }
  };
     
  const handleOpenEdit = (item: any) => {
    setEditingId(item.id);
    setEditFormData({ ...item, unit: item.unit || 'EA' });
  };
     
  const handleSaveEdit = async () => {
    try {
      const res = await fetch('/api/marketing/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData)
      });
      if (res.ok) {
        alert('✅ 정상적으로 수정되었습니다.');
        setEditingId(null);
        fetchData();
      } else { alert('수정에 실패했습니다.'); }
    } catch (error) { alert('오류가 발생했습니다.'); }
  };
     
  const handleDelete = async (id: string) => {
    if (!confirm('정말 영구 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다.)')) return;
    const res = await fetch(`/api/marketing/items?id=${id}`, { method: 'DELETE' });
    if (res.ok) { alert('완전히 삭제되었습니다.'); fetchData(); }
  };

  // 🚀 보관 처리 (Archive) 함수
  const handleArchive = async (id: string) => {
    if (!confirm('지급 이력이 존재하는 물품입니다.\n리스트에서 숨기고 "보관함"으로 이동하시겠습니까?')) return;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: true })
    });
    if (res.ok) { alert('보관함으로 이동되었습니다.'); fetchData(); }
  };

  // 🚀 복원 처리 (Restore) 함수
  const handleRestore = async (id: string) => {
    if (!confirm('보관된 물품을 다시 활성화 하시겠습니까?')) return;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: false })
    });
    if (res.ok) { alert('리스트로 복원되었습니다.'); fetchData(); }
  };
  
  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (purchaseForm.qty <= 0) return alert('수량은 1개 이상이어야 합니다.');
    const payload = {
      ...purchaseForm,
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
        alert('📦 성공적으로 입고(재고보충) 되었습니다.');
        setPurchaseModal(null);
        fetchData(); 
      } else { alert('입고 처리 실패. DB 업데이트를 확인해주세요.'); }
    } catch (err) { alert('오류 발생'); }
  };

  // 🚀 활성화된(보관되지 않은) 아이템과 보관된 아이템 분리
  const activeItems = useMemo(() => items.filter(item => !item.is_archived), [items]);
  const archivedItems = useMemo(() => items.filter(item => item.is_archived), [items]);
     
  const availableDepts = useMemo(() => {
    const activeDeptsInItems = new Set(activeItems.map(i => i.owner_dept).filter(Boolean));
    const sortedByAdminUnit = units.map(u => u.unit_name).filter(name => activeDeptsInItems.has(name));
    const finalSet = new Set(sortedByAdminUnit);
    activeDeptsInItems.forEach(d => { if (!finalSet.has(d)) sortedByAdminUnit.push(d); });
    return sortedByAdminUnit;
  }, [activeItems, units]);
  
  const filteredActiveItems = useMemo(() => {
    return activeItems.filter(item => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = selectedDept === 'ALL' || item.owner_dept === selectedDept;
      return matchSearch && matchDept;
    });
  }, [activeItems, searchQuery, selectedDept]);

  // 🚀 보관함 부서별 정렬 로직
  const groupedArchivedItems = useMemo(() => {
    const groups: Record<string, any[]> = {};
    archivedItems.forEach(item => {
      if (!groups[item.owner_dept]) groups[item.owner_dept] = [];
      groups[item.owner_dept].push(item);
    });
    return groups;
  }, [archivedItems]);
     
  if (loading) return <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Syncing Hub Master Data...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 상단 등록 폼 */}
      {canSeeAddForm && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm p-6 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-4 px-2">
            <span className="w-6 h-6 bg-indigo-600 text-white rounded-md flex items-center justify-center text-xs font-black">＋</span>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">신규 기념품 등록 (Quick Add)</h3>
          </div>
          
          <form onSubmit={handleRegister} className="flex flex-col lg:flex-row gap-3 items-stretch bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 shrink-0 bg-white border-2 border-dashed border-indigo-200 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white hover:border-indigo-500 transition-all overflow-hidden relative group"
            >
              {formData.image_url ? (
                 <img src={formData.image_url} className="w-full h-full object-cover" alt="preview" />
              ) : <span className="text-xl">📸</span>}
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, false)} />
     
            <div className="flex-1 grid grid-cols-2 lg:grid-cols-7 gap-3">
              <input required placeholder="물품명 *" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 focus:bg-white transition-all" />
              <select required value={formData.owner_dept} onChange={e=>setFormData({...formData, owner_dept: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all">
                <option value="">관리 센터 선택 *</option>
                {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
              <input type="number" placeholder="단가(원)" value={formData.unit_price} onChange={e=>setFormData({...formData, unit_price: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="초기수량" value={formData.current_stock} onChange={e=>setFormData({...formData, current_stock: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="재고확보기준수량" value={formData.alert_qty} onChange={e=>setFormData({...formData, alert_qty: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="이 수량 이하로 떨어지면 알림이 뜹니다." />
              <select value={formData.unit} onChange={e=>setFormData({...formData, unit: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all cursor-pointer">
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
            </div>
     
            <button type="submit" className="w-full lg:w-24 shrink-0 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95 h-10 lg:h-auto">신규등록</button>
          </form>
        </div>
      )}
     
      {/* 🚀 타이틀 & 보관함 보기 버튼 */}
      <div className="flex justify-between items-end pl-2 mt-8">
        <h3 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <span>🛍️</span> 물품 리스트
        </h3>
        <button onClick={() => setShowArchiveModal(true)} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-black shadow-md hover:bg-slate-700 transition-colors flex items-center gap-2">
          <span>📂</span> 미사용 보관함 보기
        </button>
      </div>

      {/* 필터 영역 */}
      <div className="bg-slate-100 p-5 rounded-[2rem] border border-slate-200 shadow-inner flex flex-col md:flex-row justify-between items-center gap-4 mt-2 mb-6">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            <button onClick={() => setSelectedDept('ALL')} className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${selectedDept === 'ALL' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 shadow-sm'}`}>
              전체 보기 ({activeItems.length})
            </button>
            {availableDepts.map(dept => {
              const count = activeItems.filter(i => i.owner_dept === dept).length;
              return (
                <button key={dept} onClick={() => setSelectedDept(dept)} className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${selectedDept === dept ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 shadow-sm'}`}>
                  {dept} ({count})
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative w-full md:w-80 shrink-0">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input type="text" placeholder="물품명 통합 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 shadow-sm transition-all" />
        </div>
      </div>
     
      {/* 🚀 카탈로그 리스트 (갤러리 폼) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredActiveItems.map(item => {
          const isEditing = editingId === item.id;
          const currentData = isEditing ? editFormData : item;
          const canDistribute = checkDistributePermission(item.owner_dept);
          const canEditThisItem = checkEditPermission(item.owner_dept);
          const currentUnit = item.unit || 'EA';
          
          // 🚀 해당 아이템이 지급 신청된 이력이 있는지 검사
          const hasDistributed = distributions.some(d => d.item_id === item.id || (d.item && d.item.id === item.id));
     
          return (
            <div key={item.id} className={`flex flex-col sm:flex-row p-6 bg-white border rounded-[2rem] transition-all shadow-sm relative group ${isEditing ? 'border-indigo-500 ring-4 ring-indigo-50 z-50' : 'border-slate-200 hover:shadow-md'}`}>
              
              {/* 좌측: 이미지 영역 */}
              <div 
                onClick={() => isEditing && editFileInputRef.current?.click()}
                className={`w-full sm:w-36 h-36 shrink-0 bg-slate-50 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-100 relative ${isEditing ? 'cursor-pointer' : ''}`}
              >
                {currentData.image_url ? (
                  <img src={currentData.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="img" />
                ) : <span className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No Image</span>}
                
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white font-black text-xs animate-in fade-in">📸 사진 변경</div>
                )}
                <input type="file" ref={editFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, true)} />
                
                {!isEditing && currentData.alert_qty > 0 && currentData.current_stock <= currentData.alert_qty && (
                  <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded-lg text-[9px] font-black animate-pulse shadow-sm">
                    🚨 재고 부족!
                  </div>
                )}
              </div>
     
              {/* 중앙: 상세 정보 및 관리자 전용 액션 영역 */}
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
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">Unit Price</span>
                      {isEditing ? (
                         <input type="number" value={currentData.unit_price} onChange={e=>setEditFormData({...editFormData, unit_price: e.target.value})} className="font-mono font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200" />
                      ) : <span className="font-mono font-black text-slate-700 text-sm">{currentData.unit_price.toLocaleString()} <span className="text-[9px] font-bold">KRW</span></span>}
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">In Stock</span>
                      {isEditing ? (
                         <input type="number" value={currentData.current_stock} onChange={e=>setEditFormData({...editFormData, current_stock: e.target.value})} className="font-mono font-black text-indigo-600 bg-slate-50 p-1.5 rounded outline-none border border-slate-200" />
                      ) : (
                        <span className={`font-mono font-black text-sm ${currentData.current_stock <= (currentData.alert_qty || 0) && currentData.alert_qty > 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                          {currentData.current_stock} <span className="text-[9px] font-bold">{currentUnit}</span>
                        </span>
                      )}
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
                        <span className="text-red-400 font-bold text-[9px] mb-0.5">알림 기준 수량</span>
                        <input type="number" value={currentData.alert_qty} onChange={e=>setEditFormData({...editFormData, alert_qty: Number(e.target.value)})} className="font-mono font-black text-red-600 bg-red-50 p-1.5 rounded outline-none border border-red-100 text-[10px]" />
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">물품 단위</span>
                        <div onClick={() => { if (hasDistributed) alert('⚠️ 1회 이상 지급 신청된 물품의 단위는 수정할 수 없습니다.\n단위가 변경된 상품은 신규 상품으로 등록해 주세요.'); }}>
                          <select 
                            disabled={hasDistributed}
                            value={currentData.unit} 
                            onChange={e=>setEditFormData({...editFormData, unit: e.target.value})} 
                            className={`font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px] w-full ${hasDistributed ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                          >
                            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="col-span-2 flex flex-col">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">부서 변경</span>
                        <select value={currentData.owner_dept} onChange={e=>setEditFormData({...editFormData, owner_dept: e.target.value})} className="font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200 text-[10px]">
                          {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
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
                          onClick={() => { setPurchaseModal(item); setPurchaseForm({ qty: 0, unit_price: item.unit_price, vendor: '', note: '', purchase_date: new Date().toISOString().split('T')[0] }); }} 
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-black hover:bg-emerald-600 hover:text-white transition-colors"
                        >📦 입고</button>
                        <button onClick={() => handleOpenEdit(item)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-md text-[10px] font-black hover:bg-slate-100 transition-colors">✏️ 수정</button>
                        
                        {/* 🚀 삭제 또는 보관함 버튼 동적 렌더링 */}
                        {!hasDistributed ? (
                          <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors">🗑️ 삭제</button>
                        ) : (
                          <button onClick={() => handleArchive(item.id)} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[10px] font-black hover:bg-black transition-colors">📦 보관</button>
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
      
      {filteredActiveItems.length === 0 && (
        <div className="py-20 text-center font-black text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-[2rem]">
          조건에 맞는 물품이 없습니다.
        </div>
      )}
     
      {/* 🚀 재고 보충(입고) 모달 */}
      {purchaseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setPurchaseModal(null)}>
          <div className="bg-white w-[420px] p-8 rounded-[2rem] shadow-2xl flex flex-col border" onClick={e=>e.stopPropagation()}>
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
                  <input required type="number" min="1" value={purchaseForm.qty} onChange={e=>setPurchaseForm({...purchaseForm, qty: Number(e.target.value)})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white" />
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
                    {(purchaseForm.qty * purchaseForm.unit_price).toLocaleString()} 원
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

      {/* 🚀 미사용 보관함(Archive) 뷰어 모달 */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6" onClick={() => setShowArchiveModal(false)}>
          <div className="bg-slate-50 w-full max-w-[1000px] h-[85vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-slate-300 animate-in zoom-in-95 duration-200" onClick={e=>e.stopPropagation()}>
            <div className="bg-slate-800 p-6 flex justify-between items-center text-white shrink-0">
              <div>
                <h3 className="text-xl font-black tracking-tight flex items-center gap-2"><span>📂</span> 미사용 물품 보관함</h3>
                <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-widest font-bold">Archived Catalog Items</p>
              </div>
              <button onClick={() => setShowArchiveModal(false)} className="w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-xl transition-colors">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {Object.keys(groupedArchivedItems).length === 0 ? (
                <div className="py-32 text-center text-slate-400 font-black text-lg">보관된 물품이 없습니다.</div>
              ) : (
                Object.entries(groupedArchivedItems).map(([dept, items]) => (
                  <div key={dept} className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
                    <div className="bg-slate-100 p-4 border-b border-slate-200 flex items-center gap-3">
                      <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-3 py-1.5 rounded-lg shadow-sm">{dept}</span>
                      <span className="text-xs font-bold text-slate-500">총 {items.length}건 보관 중</span>
                    </div>
                    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {items.map(item => (
                        <div key={item.id} className="flex gap-4 p-4 border border-slate-100 rounded-2xl bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-colors group">
                          <div className="w-20 h-20 bg-slate-100 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 grayscale group-hover:grayscale-0 transition-all">
                            {item.image_url ? <img src={item.image_url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100" /> : <span className="text-[8px] font-black text-slate-300 uppercase">No Image</span>}
                          </div>
                          <div className="flex flex-col justify-center flex-1">
                            <h4 className="font-black text-slate-700 text-sm line-clamp-1">{item.name}</h4>
                            <div className="flex gap-4 mt-2">
                              <span className="text-[10px] text-slate-500 font-bold">단가: <span className="font-mono text-slate-800">{item.unit_price.toLocaleString()}원</span></span>
                              <span className="text-[10px] text-slate-500 font-bold">잔여재고: <span className="font-mono text-slate-800">{item.current_stock}{item.unit || 'EA'}</span></span>
                            </div>
                          </div>
                          <div className="flex items-center justify-center shrink-0 pr-2">
                            <button onClick={() => handleRestore(item.id)} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded-xl text-[10px] font-black hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors shadow-sm whitespace-nowrap">
                              ↺ 메인 복원
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
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