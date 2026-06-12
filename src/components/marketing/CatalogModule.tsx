'use client';
     
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 

// 🚀 [UI 표준] 전사 공통 헤더
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
      <h2 className="text-xs font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
     
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
  
  const [unitOptions, setUnitOptions] = useState<string[]>(['EA', 'BOX', 'SET']);
     
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
     
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  
  const [purchaseModal, setPurchaseModal] = useState<any>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    qty: 0, unit_price: 0, vendor: '', note: '', purchase_date: new Date().toISOString().split('T')[0]
  });
  
  // 하단 배너 (종료된 물품) 필터 및 페이지네이션 상태
  const [isEndedOpen, setIsEndedOpen] = useState<boolean>(false);
  const [endedDeptFilter, setEndedDeptFilter] = useState<string>('ALL');
  const [endedYearFilter, setEndedYearFilter] = useState<string>('ALL');
  const [endedPage, setEndedPage] = useState<number>(1);
  const itemsPerEndedPage = 10; 
     
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
      const ts = Date.now();
      const [iRes, uRes, meRes, ifRes, sysRes, masterRes, dRes] = await Promise.all([
        fetch('/api/marketing/items?t=' + ts),
        fetch('/api/admin/units?active=true&t=' + ts),
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/admin/config?t=' + ts),
        fetch('/api/admin/master-data?t=' + ts),
        fetch('/api/marketing/distributions?t=' + ts)
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
    } else {
      alert('등록에 실패했습니다. DB 연결 상태를 확인해주세요.');
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
     
  const handleEndItem = async (id: string) => {
    if (!confirm('지급 이력이 존재하는 물품입니다.\n현재 리스트에서 숨기고 "종료된 과거 내역"으로 처리하시겠습니까?')) return;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: true })
    });
    if (res.ok) { alert('과거 내역으로 종료 처리되었습니다.'); fetchData(); }
  };
     
  const handleRestore = async (id: string) => {
    if (!confirm('종료된 상품을 다시 활성 물품 리스트로 복구하시겠습니까?')) return;
    const res = await fetch('/api/marketing/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_archived: false })
    });
    if (res.ok) { alert('활성 리스트로 복원되었습니다.'); fetchData(); }
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
     
  const activeItems = useMemo(() => items.filter(item => !item.is_archived), [items]);
  const endedItems = useMemo(() => items.filter(item => item.is_archived), [items]); 
     
  const availableDepts = useMemo(() => {
    const activeDeptsInItems = new Set(activeItems.map(i => i.owner_dept).filter(Boolean));
    const sortedByAdminUnit = units.map(u => u.unit_name).filter(name => activeDeptsInItems.has(name));
    const finalSet = new Set(sortedByAdminUnit);
    activeDeptsInItems.forEach(d => { if (!finalSet.has(d)) sortedByAdminUnit.push(d); });
    return sortedByAdminUnit;
  }, [activeItems, units]);

  const availableEndedDepts = useMemo(() => {
    const depts = new Set(endedItems.map(i => i.owner_dept).filter(Boolean));
    return Array.from(depts).sort();
  }, [endedItems]);
  
  const filteredActiveItems = useMemo(() => {
    return activeItems.filter(item => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = selectedDept === 'ALL' || item.owner_dept === selectedDept;
      return matchSearch && matchDept;
    });
  }, [activeItems, searchQuery, selectedDept]);

  const filteredEndedItems = useMemo(() => {
    return endedItems.filter(item => {
      const matchDept = endedDeptFilter === 'ALL' || item.owner_dept === endedDeptFilter;
      const itemYear = new Date(item.updatedAt || item.createdAt).getFullYear().toString();
      const matchYear = endedYearFilter === 'ALL' || itemYear === endedYearFilter;
      return matchDept && matchYear;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [endedItems, endedDeptFilter, endedYearFilter]);

  const paginatedEndedItems = useMemo(() => {
    const start = (endedPage - 1) * itemsPerEndedPage;
    return filteredEndedItems.slice(start, start + itemsPerEndedPage);
  }, [filteredEndedItems, endedPage]);

  const totalEndedPages = Math.ceil(filteredEndedItems.length / itemsPerEndedPage);
     
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
              <select value={formData.unit || ''} onChange={e=>setFormData({...formData, unit: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all cursor-pointer">
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
            </div>
     
            <button type="submit" className="w-full lg:w-24 shrink-0 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95 h-10 lg:h-auto">신규등록</button>
          </form>
        </div>
      )}
     
      <div className="flex justify-between items-end pl-2 mt-8">
        <h3 className="font-black text-sm text-slate-800 flex items-center gap-2">
          <span>🛍️</span> 활성 물품 리스트
        </h3>
      </div>
     
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
     
      {/* 🚀 활성 카탈로그 리스트 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredActiveItems.map(item => {
          const isEditing = editingId === item.id;
          const currentData = isEditing ? editFormData : item;
          const canDistribute = checkDistributePermission(item.owner_dept);
          const canEditThisItem = checkEditPermission(item.owner_dept);
          
          const currentUnit = currentData.unit || 'EA';
          const hasDistributed = distributions.some(d => d.item_id === item.id || (d.item && d.item.id === item.id));
     
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
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white font-black text-xs animate-in fade-in">📸 사진 변경</div>
                )}
                <input type="file" ref={editFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, true)} />
                
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
                      {/* 🚀 라벨 수정: 단가(원) */}
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">단가(원)</span>
                      {isEditing ? (
                         <input type="number" value={currentData.unit_price} onChange={e=>setEditFormData({...editFormData, unit_price: e.target.value})} className="font-mono font-black text-slate-700 bg-slate-50 p-1.5 rounded outline-none border border-slate-200" />
                      ) : <span className="font-mono font-black text-slate-700 text-sm">{currentData.unit_price.toLocaleString()} <span className="text-[9px] font-bold">KRW</span></span>}
                    </div>
                    
                    <div className="flex flex-col">
                      {/* 🚀 라벨 수정: 재고 */}
                      <span className="text-slate-400 font-bold uppercase text-[9px] mb-0.5">재고</span>
                      {isEditing ? (
                         <input type="number" value={currentData.current_stock} onChange={e=>setEditFormData({...editFormData, current_stock: e.target.value})} className="font-mono font-black text-indigo-600 bg-slate-50 p-1.5 rounded outline-none border border-slate-200" />
                      ) : (
                        <span className={`font-mono font-black text-sm ${currentData.current_stock <= (currentData.alert_qty || 0) && currentData.alert_qty > 0 ? 'text-red-500' : 'text-indigo-600'}`}>
                          {currentData.current_stock} <span className="text-[10px] font-bold pl-1">{currentUnit}</span>
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
                        {/* 🚀 라벨 수정: 재고확보 기준수량 */}
                        <span className="text-red-400 font-bold text-[9px] mb-0.5">재고확보 기준수량</span>
                        <input type="number" value={currentData.alert_qty} onChange={e=>setEditFormData({...editFormData, alert_qty: Number(e.target.value)})} className="font-mono font-black text-red-600 bg-red-50 p-1.5 rounded outline-none border border-red-100 text-[10px]" />
                      </div>
                      
                      <div className="flex flex-col">
                        <span className="text-slate-400 font-bold text-[9px] mb-0.5">물품 단위</span>
                        <div onClick={() => { if (hasDistributed) alert('⚠️ 1회 이상 지급 신청된 물품의 단위는 수정할 수 없습니다.\n단위가 변경된 상품은 신규 상품으로 등록해 주세요.'); }}>
                          <select 
                            disabled={hasDistributed}
                            value={currentData.unit || ''} 
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
                        
                        {!hasDistributed ? (
                          <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-md text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors">🗑️ 삭제</button>
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
      
      {filteredActiveItems.length === 0 && (
        <div className="py-20 text-center font-black text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-[2rem]">
          조건에 맞는 활성 물품이 없습니다.
        </div>
      )}
     
      {/* 재고 보충(입고) 모달 */}
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

      {/* 전사 표준 아코디언 트리거: 종료된 물품 과거 이력 */}
      <div 
        onClick={() => setIsEndedOpen(!isEndedOpen)}
        className="w-full bg-slate-800 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[120px] mt-12 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all select-none"
      >
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Ended Items History (Click to Toggle)</p>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            종료된 과거 물품 내역
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
              {isEndedOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </h2>
          <p className="text-slate-300 text-xs font-semibold mt-2 opacity-90">재고가 소진되었거나 지급이 완전히 종료되어 과거 이력으로 남은 상품 목록입니다.</p>
        </div>
      </div>

      {/* 종료된 물품 리스트 및 필터 영역 */}
      {isEndedOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <HeaderLight title="종료 물품 리스트" count={filteredEndedItems.length}>
            <div className="flex items-center gap-4 text-xs font-bold text-slate-600">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">연도 :</span>
                <select 
                  value={endedYearFilter} 
                  onChange={(e) => { setEndedYearFilter(e.target.value); setEndedPage(1); }} 
                  className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-1.5 font-black focus:outline-none focus:border-indigo-500 text-[11px] cursor-pointer shadow-sm transition-colors"
                >
                  <option value="ALL">전체 내역 보기</option>
                  <option value="2026">2026년</option>
                  <option value="2025">2025년</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">조직 :</span>
                <select 
                  value={endedDeptFilter} 
                  onChange={(e) => { setEndedDeptFilter(e.target.value); setEndedPage(1); }} 
                  className="bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-1.5 font-black focus:outline-none focus:border-indigo-500 text-[11px] cursor-pointer shadow-sm transition-colors"
                >
                  <option value="ALL">전체</option>
                  {availableEndedDepts.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
            </div>
          </HeaderLight>

          <div className="overflow-x-auto p-2">
            {filteredEndedItems.length === 0 ? (
              <div className="py-20 text-center font-black text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200 m-4">
                선택한 조건의 종료된 물품 내역이 없습니다.
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-4 text-center w-16">NO</th>
                    <th className="py-2 px-3 w-16 text-center">이미지</th>
                    <th className="py-2 px-4">상품명</th>
                    <th className="py-2 px-3 text-right">단가(원)</th>
                    <th className="py-2 px-3 text-right">재고</th>
                    <th className="py-2 px-4 w-48">상세설명</th>
                    <th className="py-2 px-3 text-center">소속부서</th>
                    <th className="py-2 px-3 text-center">종료일</th>
                    <th className="py-2 px-4 text-center w-36">액션</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                  {paginatedEndedItems.map((item, index) => {
                     const reverseNo = filteredEndedItems.length - ((endedPage - 1) * itemsPerEndedPage + index);
                     const endDate = (item.updatedAt || item.createdAt)?.split('T')[0] || '-';
                     
                     // 🚀 권한 판별 변수
                     const isLV1 = currentUser?.roles?.includes('LV_1');
                     const canEditThisItem = checkEditPermission(item.owner_dept);

                     return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2 text-center text-slate-400 font-black">{reverseNo}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="w-10 h-10 mx-auto bg-slate-100 rounded-md overflow-hidden border border-slate-200 shadow-sm">
                               {item.image_url ? (
                                 <img src={item.image_url} className="w-full h-full object-cover opacity-80" alt="img" />
                               ) : (
                                 <span className="text-[6px] font-black flex items-center justify-center h-full text-slate-300">NO IMG</span>
                               )}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-slate-800 line-clamp-1 border-none mt-2 block">{item.name}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{item.unit_price.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{item.current_stock} <span className="text-[9px] text-slate-400">{item.unit || 'EA'}</span></td>
                          <td className="px-4 py-2"><div className="line-clamp-2 text-[10px] text-slate-500 font-medium">{item.description || '-'}</div></td>
                          <td className="px-3 py-2 text-center"><span className="bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded text-[9px] font-black">{item.owner_dept}</span></td>
                          <td className="px-3 py-2 text-center text-slate-500 font-mono text-[11px]">{endDate}</td>
                          <td className="px-4 py-2 text-center">
                             {/* 🚀 버튼 좌우 나란히 배치 및 권한 연동 완료 */}
                             <div className="flex flex-row gap-1.5 justify-center">
                                {canEditThisItem && (
                                  <button onClick={() => handleRestore(item.id)} className="flex-1 py-1.5 bg-white border border-slate-300 text-slate-600 rounded text-[9px] font-black hover:bg-slate-800 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                                    ↺ 복구
                                  </button>
                                )}
                                {isLV1 && (
                                  <button onClick={() => handleDelete(item.id)} className="flex-1 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors whitespace-nowrap">
                                    🗑️ 영구 삭제
                                  </button>
                                )}
                             </div>
                          </td>
                        </tr>
                     )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* 테이블 하단 10개 단위 페이지네이션 */}
          {totalEndedPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 py-4 border-t border-slate-100 bg-white">
              <button disabled={endedPage === 1} onClick={() => setEndedPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">이전</button>
              {Array.from({ length: totalEndedPages }).map((_, i) => (
                <button key={i} onClick={() => setEndedPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${endedPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={endedPage === totalEndedPages} onClick={() => setEndedPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 hover:bg-slate-50">다음</button>
            </div>
          )}
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