'use client';
     
import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation'; 
import * as XLSX from 'xlsx';
     
// 🚀 1. 알맹이 함수 이름을 CatalogContent로 변경합니다.
function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
     
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
     
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
     
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  
  const [purchaseModal, setPurchaseModal] = useState<any>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    qty: 0, unit_price: 0, vendor: '', note: '', purchase_date: new Date().toISOString().split('T')[0]
  });
     
  const initialForm = { name: '', unit_price: '', current_stock: '', alert_qty: '', owner_dept: '', description: '', image_url: '', owner_type: 'CENTER' };
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
      const [iRes, uRes, meRes, ifRes, sysRes] = await Promise.all([
        fetch('/api/marketing/items'),
        fetch('/api/admin/units?active=true'),
        fetch('/api/auth/me'),
        fetch('/api/admin/interface'),
        fetch('/api/admin/config')
      ]);
      
      if (iRes.ok) setItems(await iRes.json());
      if (uRes.ok) setUnits(await uRes.json());
      if (meRes.ok) setCurrentUser(await meRes.json());
      if (sysRes.ok) setSystemConfig(await sysRes.json());
      if (ifRes.ok) {
        const interfaces = await ifRes.json();
        const config = interfaces.find((m: any) => m.path === '/marketing/distribution/catalog');
        setInterfaceConfig(config);
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
      setFormData(initialForm);
      fetchData();
    }
  };
     
  const handleOpenEdit = (item: any) => {
    setEditingId(item.id);
    setEditFormData({ ...item });
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
    if (!confirm('정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    const res = await fetch(`/api/marketing/items?id=${id}`, { method: 'DELETE' });
    if (res.ok) { alert('삭제되었습니다.'); fetchData(); }
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
     
  const availableDepts = useMemo(() => {
    const activeDeptsInItems = new Set(items.map(i => i.owner_dept).filter(Boolean));
    const sortedByAdminUnit = units.map(u => u.unit_name).filter(name => activeDeptsInItems.has(name));
    const finalSet = new Set(sortedByAdminUnit);
    activeDeptsInItems.forEach(d => { if (!finalSet.has(d)) sortedByAdminUnit.push(d); });
    return sortedByAdminUnit;
  }, [items, units]);
  
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = selectedDept === 'ALL' || item.owner_dept === selectedDept;
      return matchSearch && matchDept;
    });
  }, [items, searchQuery, selectedDept]);
     
  if (loading) return <div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Syncing Hub Master Data...</div>;
     
  return (
    <div className="p-8 space-y-8 animate-fade-in max-w-[1600px] mx-auto font-sans text-slate-900 pb-24">
      
      {/* 🚀 상단 등록 폼 */}
      {canSeeAddForm && (
        <div className="bg-white border-2 border-indigo-50 rounded-[2.5rem] shadow-sm p-5 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 mb-3 px-2">
            <span className="w-6 h-6 bg-indigo-600 text-white rounded-md flex items-center justify-center text-xs font-black">＋</span>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">신규 기념품 등록 (Quick Add)</h3>
          </div>
          
          <form onSubmit={handleRegister} className="flex flex-col lg:flex-row gap-3 items-stretch bg-slate-50 p-3 rounded-2xl border border-slate-100 shadow-inner">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 shrink-0 bg-white border-2 border-dashed border-indigo-200 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white hover:border-indigo-500 transition-all overflow-hidden relative group"
            >
              {formData.image_url ? (
                 <img src={formData.image_url} className="w-full h-full object-cover" alt="preview" />
              ) : <span className="text-xl">📸</span>}
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, false)} />
     
            <div className="flex-1 grid grid-cols-2 lg:grid-cols-6 gap-3">
              <input required placeholder="물품명 *" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 focus:bg-white transition-all" />
              <select required value={formData.owner_dept} onChange={e=>setFormData({...formData, owner_dept: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none bg-white focus:ring-2 ring-indigo-500 transition-all">
                <option value="">관리 센터 선택 *</option>
                {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
              </select>
              <input type="number" placeholder="단가(원)" value={formData.unit_price} onChange={e=>setFormData({...formData, unit_price: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="초기 수량" value={formData.current_stock} onChange={e=>setFormData({...formData, current_stock: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" />
              <input type="number" placeholder="재고확보 기준수량" value={formData.alert_qty} onChange={e=>setFormData({...formData, alert_qty: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all" title="이 수량 이하로 떨어지면 알림이 뜹니다." />
              <input placeholder="상세 설명 (선택)" value={formData.description} onChange={e=>setFormData({...formData, description: e.target.value})} className="w-full p-2.5 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 transition-all lg:col-span-1" />
            </div>
     
            <button type="submit" className="w-full lg:w-24 shrink-0 bg-slate-900 text-white rounded-xl text-[11px] font-black shadow-lg hover:bg-indigo-600 transition-all active:scale-95 h-10 lg:h-auto">신규등록</button>
          </form>
        </div>
      )}
     
      {/* 🚀 리스트 타이틀 & 탭 & 검색 */}
      <div className="space-y-3">
        <h3 className="font-black text-sm text-slate-800 flex items-center gap-2 pl-2">
          <span>🛍️</span> 물품 리스트
        </h3>
        
        <div className="bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex gap-2 overflow-x-auto w-full md:w-auto scrollbar-hide px-1">
            <button onClick={() => setSelectedDept('ALL')} className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${selectedDept === 'ALL' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              전체 보기 ({items.length})
            </button>
            {availableDepts.map(dept => {
              const count = items.filter(i => i.owner_dept === dept).length;
              return (
                <button key={dept} onClick={() => setSelectedDept(dept)} className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all border whitespace-nowrap ${selectedDept === dept ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                  {dept} ({count})
                </button>
              );
            })}
          </div>
          <div className="relative w-full md:w-80 shrink-0">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input type="text" placeholder="물품명 통합 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white transition-all shadow-inner" />
          </div>
        </div>
      </div>
     
      {/* 🚀 카탈로그 리스트 (2열 그리드) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {filteredItems.map(item => {
          const isEditing = editingId === item.id;
          const currentData = isEditing ? editFormData : item;
          const canDistribute = checkDistributePermission(item.owner_dept);
          const canEditThisItem = checkEditPermission(item.owner_dept);
     
          return (
            <div key={item.id} className={`flex flex-col sm:flex-row gap-6 p-6 bg-white border rounded-[2.5rem] transition-all shadow-sm relative group ${isEditing ? 'border-indigo-500 ring-8 ring-indigo-50 z-50' : 'border-slate-200 hover:shadow-xl hover:border-slate-300'}`}>
              
              {/* 이미지 영역 */}
              <div 
                onClick={() => isEditing && editFileInputRef.current?.click()}
                className={`w-full sm:w-44 h-44 shrink-0 bg-slate-100 rounded-3xl flex items-center justify-center overflow-hidden border border-slate-100 relative ${isEditing ? 'cursor-pointer' : ''}`}
              >
                {currentData.image_url ? (
                  <img src={currentData.image_url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt="img" />
                ) : <span className="text-slate-300 font-black text-xs uppercase tracking-widest">No Image</span>}
                
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white font-black text-xs animate-in fade-in">📸 사진 변경</div>
                )}
                <input type="file" ref={editFileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, true)} />
                
                {!isEditing && currentData.alert_qty > 0 && currentData.current_stock <= currentData.alert_qty && (
                  <div className="absolute top-3 left-3 bg-red-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black animate-pulse shadow-lg shadow-red-200 border border-red-400">
                    🚨 재고 확보! ({currentData.current_stock}EA)
                  </div>
                )}
              </div>
     
              {/* 상세 정보 영역 */}
              <div className="flex-1 flex flex-col justify-center space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  {isEditing ? (
                    <input value={currentData.name} onChange={e=>setEditFormData({...editFormData, name: e.target.value})} className="w-full font-black text-xl text-blue-600 bg-blue-50/50 px-2 py-1 rounded outline-none border-b-2 border-blue-200" />
                  ) : (
                    <h4 className={`text-xl font-black line-clamp-1 ${canDistribute ? 'text-slate-800' : 'text-slate-400'}`}>{currentData.name}</h4>
                  )}
                  {!isEditing && (
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-full ml-2 shrink-0 border whitespace-nowrap ${canDistribute ? 'bg-indigo-50 text-indigo-600 border-indigo-100 shadow-sm' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                      {item.owner_dept}
                    </span>
                  )}
                </div>
     
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[11px]">
                  <div className="flex flex-col">
                    <span className="text-slate-400 font-black uppercase tracking-tighter mb-1">Unit Price</span>
                    {isEditing ? (
                       <input type="number" value={currentData.unit_price} onChange={e=>setEditFormData({...editFormData, unit_price: e.target.value})} className="font-mono font-black text-slate-700 bg-slate-100 p-2 rounded-xl outline-none" />
                    ) : <span className="font-mono font-black text-slate-700 text-base">{currentData.unit_price.toLocaleString()} <span className="text-[10px] font-bold">KRW</span></span>}
                  </div>
                  
                  <div className="flex flex-col">
                    <span className="text-slate-400 font-black uppercase tracking-tighter mb-1">In Stock</span>
                    {isEditing ? (
                       <input type="number" value={currentData.current_stock} onChange={e=>setEditFormData({...editFormData, current_stock: e.target.value})} className="font-mono font-black text-indigo-600 bg-slate-100 p-2 rounded-xl outline-none" />
                    ) : <span className={`font-mono font-black text-base ${currentData.current_stock <= (currentData.alert_qty || 0) && currentData.alert_qty > 0 ? 'text-red-500 animate-pulse' : 'text-indigo-600'}`}>{currentData.current_stock} <span className="text-[10px] font-bold">EA</span></span>}
                  </div>
     
                  {isEditing && (
                    <div className="col-span-2 flex flex-col mt-1 border-t border-dashed border-red-200 pt-2">
                      <span className="text-red-400 font-black tracking-tighter mb-1">🚨 재고확보 알림 기준 수량</span>
                      <input type="number" value={currentData.alert_qty} onChange={e=>setEditFormData({...editFormData, alert_qty: Number(e.target.value)})} className="font-mono font-black text-red-600 bg-red-50 p-2 rounded-xl outline-none border border-red-100" placeholder="0이면 알림 꺼짐" />
                    </div>
                  )}
     
                  {isEditing && (
                    <div className="col-span-2 flex flex-col mt-1 border-t border-slate-100 pt-2">
                      <span className="text-slate-400 font-black uppercase tracking-tighter mb-1">Owner Dept Change</span>
                      <select value={currentData.owner_dept} onChange={e=>setEditFormData({...editFormData, owner_dept: e.target.value})} className="font-black text-slate-700 bg-slate-100 p-2 rounded-xl outline-none">
                        {units.map(u => <option key={u.id} value={u.unit_name}>{u.unit_name}</option>)}
                      </select>
                    </div>
                  )}
                  
                  <div className="col-span-2 flex flex-col mt-1">
                    <span className="text-slate-400 font-black uppercase tracking-tighter mb-1">Description</span>
                    {isEditing ? (
                      <textarea value={currentData.description} onChange={e=>setEditFormData({...editFormData, description: e.target.value})} className="font-bold text-slate-600 bg-slate-100 p-3 rounded-xl outline-none resize-none h-16" />
                    ) : <span className="font-bold text-slate-500 line-clamp-2 bg-slate-50/50 p-3 rounded-2xl border border-slate-100 min-h-[50px] leading-relaxed">{currentData.description || '-'}</span>}
                  </div>
                </div>
              </div>
     
              {/* 🚀 액션 버튼 영역 (수정/삭제 버튼 찌그러짐 방지 적용) */}
              <div className="w-full sm:w-28 shrink-0 flex sm:flex-col gap-2.5 justify-center border-t sm:border-t-0 sm:border-l border-slate-100 pt-5 sm:pt-0 sm:pl-6">
                {isEditing ? (
                  <>
                    <button onClick={handleSaveEdit} className="flex-1 sm:flex-none py-3 bg-emerald-600 text-white rounded-2xl font-black text-[11px] shadow-lg hover:bg-emerald-700 active:scale-95 transition-all whitespace-nowrap">💾 SAVE</button>
                    <button onClick={() => setEditingId(null)} className="flex-1 sm:flex-none py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-[11px] hover:bg-slate-200 transition-all whitespace-nowrap">CANCEL</button>
                  </>
                ) : (
                  <>
                    {canEditThisItem && (
                      <button 
                        onClick={() => {
                          setPurchaseModal(item);
                          setPurchaseForm({ qty: 0, unit_price: item.unit_price, vendor: '', note: '', purchase_date: new Date().toISOString().split('T')[0] });
                        }} 
                        className="py-2.5 w-full bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-xl text-[10px] font-black hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        📦 재고 입고
                      </button>
                    )}
                    
                    {canEditThisItem && (
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => handleOpenEdit(item)} className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[10px] font-black hover:bg-slate-900 hover:text-white transition-all shadow-sm whitespace-nowrap flex items-center justify-center gap-1">
                          ✏️ 수정
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="flex-1 py-2 bg-red-50 border border-red-100 text-red-500 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-white transition-all shadow-sm whitespace-nowrap flex items-center justify-center gap-1">
                          🗑️ 삭제
                        </button>
                      </div>
                    )}
                    
                    <div className="hidden sm:block h-px w-full bg-slate-100 my-1"></div>
                    
                    <button 
                      onClick={() => router.push(`/marketing/distribution/register?itemId=${item.id}`)}
                      disabled={!canDistribute || item.current_stock <= 0}
                      className={`py-3.5 w-full rounded-2xl text-[11px] font-black shadow-lg transition-all uppercase tracking-wider whitespace-nowrap
                        ${canDistribute && item.current_stock > 0 
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-indigo-100' 
                          : 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'}`}
                    >
                      {canDistribute ? (item.current_stock > 0 ? '지급하기' : 'Sold Out') : 'No Access'}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
     
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
                  <label className="text-[10px] font-black text-slate-600 uppercase">입고 수량 *</label>
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
    </div>
  );
}
     
// 🚀 2. 모듈 외곽을 CatalogModule로 선언하여 내보냅니다.
export default function CatalogModule() {
  return (
    <Suspense fallback={<div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Loading Catalog Environment...</div>}>
      <CatalogContent />
    </Suspense>
  );
}