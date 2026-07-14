// src/components/asset/supplies/InventoryModule.tsx
'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
     
export default function InventoryModule() {
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [reqForm, setReqForm] = useState({ qty: 1, note: '' });
     
  // 🚀 유저 정보와 컴포넌트 최초 아이템 데이터 바인딩 로드 분리
  useEffect(() => { 
    const initLoad = async () => {
      setLoading(true);
      await Promise.all([fetchCurrentUser(), syncItemsOnly()]);
      setLoading(false);
    };
    initLoad();
  }, []);
     
  // 사용자 정보는 세션이 바뀌지 않으므로 딱 한 번만 캡처
  const fetchCurrentUser = async () => {
    try {
      const res = await fetch(`/api/auth/me?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setCurrentUser(await res.ok && res.json ? await res.json() : null);
    } catch (e) {
      console.error("유저 정보 로드 실패:", e);
    }
  };

  // 🚀 초고속 순수 아이템 동기화 전용 엔진 (네트워크 병목 완전 제거)
  const syncItemsOnly = async () => {
    try {
      const itemRes = await fetch(`/api/asset/supplies/inventory?t=${Date.now()}`, { cache: 'no-store' });
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        setItems(itemData.items || []); 
      }
    } catch (e) { 
      console.error("실시간 재고 동기화 실패:", e); 
    }
  };
     
  const openPopup = (item: any) => {
    setSelectedItem(item);
    setReqForm({ qty: 1, note: '' });
  };
     
  const handleRequestSubmit = async () => {
    const qty = Number(reqForm.qty) || 1;
    if (qty <= 0) return alert('1개 이상 신청해주세요.');
    if (qty > Number(selectedItem.current_stock)) return alert('현재고보다 많이 신청할 수 없습니다.');
    
    // 1️⃣ 낙관적 업데이트 즉시 적용 (화면 재고 선다운)
    setItems(prevItems => prevItems.map(item => 
      item.id === selectedItem.id 
        ? { ...item, current_stock: Math.max(0, item.current_stock - qty) } 
        : item
    ));
     
    try {
      let sUnit = '';
      try {
         const ext = selectedItem.description ? JSON.parse(selectedItem.description) : {};
         sUnit = ext.r_unit || ext.s_unit || '';
      } catch (e) {}
     
      const payload = {
        item_id: selectedItem.id,
        item_name: selectedItem.name,
        qty: qty,
        note: reqForm.note,
        unit: sUnit,
        user_id: currentUser?.id 
      };
     
      const res = await fetch('/api/asset/supplies/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
       
      if (res.ok) {
        alert('✅ 정상적으로 신청이 완료되었습니다.\n(신청 수량만큼 재고가 우선 차감되었습니다.)');
        setSelectedItem(null);
        await syncItemsOnly(); // 🚀 유저 조회 빼고 오직 재고만 백그라운드 갱신 (딜레이 제로)
      } else { 
        const errorText = await res.text();
        alert(`🚨 서버에서 신청을 거부했습니다.\n상세 오류: ${errorText}`); 
        await syncItemsOnly(); 
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
      await syncItemsOnly(); 
    }
  };
     
  // 백엔드 정렬 가속화를 완료했으므로 프론트는 심플 필터만 유지해 메모리 낭비 제거
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (item.is_active === false) return false;
      if (item.is_published === false) return false;
      if (searchQuery && !item.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [items, searchQuery]);
     
  if (loading) return <div className="p-20 text-center font-black text-indigo-600 animate-pulse text-xl tracking-widest uppercase">Syncing Realtime Inventory Catalog...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 🚀 상단 대형 헤더 배너 (전사 공용 신청 대장이므로 Blue 그라데이션 유지 & 개인정보 제외) */}
<div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[140px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
  
  <div className="relative z-10">
    {/* 1. 상단 라벨 (먹색 배너와 완벽 일치: text-[10px], mb-3) */}
    <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-3">
      General Office Supplies
    </p>
    
    {/* 2. 메인 타이틀 (먹색 배너와 완벽 일치: text-2xl, leading-none 추가) */}
    <h1 className="text-2xl font-black tracking-tight text-white leading-none">
      소모품 조회 및 신청 대장
    </h1>
    
    {/* 3. 하단 설명 (먹색 배너와 완벽 일치: text-xs, mt-4) */}
    <p className="text-blue-100 text-xs font-semibold mt-4 opacity-90 max-w-[3xl]">
      경영기획실에서 중앙 관리하는 사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고 신청합니다.
    </p>
  </div>

  {/* 배경 아이콘 (포인터 이벤트 차단) */}
  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    📦
  </div>
</div>
     
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">비품 청구 리스트</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredItems.length}개 품목</span>
          </div>
     
          <div className="relative w-full sm:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            <input type="text" placeholder="물품명 검색..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 transition-colors shadow-sm" />
          </div>
        </div>
  
        <div className="p-6 bg-slate-50/50">
          {filteredItems.length === 0 ? (
            <div className="py-20 text-center text-slate-400 text-xs font-bold">{searchQuery ? '검색된 품목이 없습니다.' : '현재 게시된 소모품이 없습니다.'}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {filteredItems.map(item => {
                let rUnit = '';
                try {
                  const ext = item.description ? JSON.parse(item.description) : {};
                  rUnit = ext.s_unit || ext.r_unit || '';
                } catch (e) {}
     
                const currentStock = Number(item.current_stock) || 0;
                const isOut = currentStock <= 0;
          
                return (
                  <div key={item.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-all group flex flex-col h-full">
                    <div className={`w-full h-32 bg-slate-50/50 flex items-center justify-center relative border-b border-slate-100 ${isOut ? 'grayscale opacity-70' : ''}`}>
                      {item.image_url ? (
                        <div className="w-16 h-16 bg-white rounded-xl shadow-sm border border-slate-200 p-1.5 flex items-center justify-center overflow-hidden">
                          <img src={item.image_url} alt={item.name} className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-300" />
                        </div>
                      ) : <span className="text-4xl opacity-10">📦</span>}
                      <div className="absolute top-2 right-2">
                        {isOut ? <span className="px-2 py-0.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[9px] font-black shadow-sm tracking-widest">품절</span>
                               : <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-md text-[9px] font-black shadow-sm tracking-widest">정상</span>}
                      </div>
                    </div>
                    
                    <div className="p-3 flex flex-col flex-1">
                      <h3 className={`text-[12px] font-black leading-tight mb-1 line-clamp-2 h-[34px] ${isOut ? 'text-slate-400 line-through' : 'text-slate-800'}`} title={item.name}>{item.name}</h3>
                      <span className="text-[9px] text-slate-400 font-bold mb-3 uppercase tracking-widest truncate">{item.category || '소모품'}</span>
                      
                      <div className="mt-auto flex flex-col gap-2 pt-3 border-t border-slate-50">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-black text-slate-400">현재고</span>
                          <span className={`font-mono font-black text-sm leading-none ${isOut ? 'text-slate-400' : 'text-indigo-600'}`}>
                            {currentStock.toLocaleString()} {rUnit && <span className="text-[9px] font-sans text-slate-500 ml-0.5">{rUnit}</span>}
                          </span>
                        </div>
                        <button 
                          onClick={() => openPopup(item)} disabled={isOut}
                          className={`w-full py-1.5 rounded-lg text-[10px] font-black tracking-wide uppercase transition-all shadow-sm ${
                            isOut ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' : 'bg-slate-900 text-white hover:bg-blue-600 active:scale-95'
                          }`}
                        >
                          {isOut ? '불가' : '신청하기'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
     
      {selectedItem && (() => {
        let sUnit = '';
        try {
          const ext = selectedItem.description ? JSON.parse(selectedItem.description) : {};
          sUnit = ext.s_unit || ext.r_unit || '';
        } catch (e) {}
     
        return (
          <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-12 duration-500">
              <div className="bg-slate-900 p-6 flex justify-between items-center text-white">
                <h3 className="text-sm font-black tracking-wide">소모품 신청서 작성</h3>
                <button onClick={() => setSelectedItem(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">✕</button>
              </div>
              <div className="p-8 space-y-6">
                <div className="space-y-1">
                  <p className="text-[11px] font-black text-indigo-500 mb-3 tracking-widest">신청자 정보</p>
                  <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                    <span className="text-[12px] font-bold text-slate-400">신청 부서</span>
                    <span className="text-[13px] font-black text-slate-800">{currentUser?.unit?.unit_name || currentUser?.dept_name || '정보 없음'}</span>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                    <span className="text-[12px] font-bold text-slate-400">신청인</span>
                    <span className="text-[13px] font-black text-slate-800">{currentUser?.name} {currentUser?.email ? `(${currentUser.email.split('@')[0]})` : ''}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-black text-indigo-500 mb-3 mt-2 tracking-widest">물품 정보</p>
                  <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                    <span className="text-[12px] font-bold text-slate-400">물품명</span>
                    <span className="text-[13px] font-black text-slate-900 leading-tight">{selectedItem.name}</span>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                    <span className="text-[12px] font-bold text-slate-400">현재고</span>
                    <span className="text-[13px] font-mono font-black text-indigo-600">{Number(selectedItem.current_stock).toLocaleString()} {sUnit && <span className="text-[11px] font-sans text-slate-400 ml-1">{sUnit}</span>}</span>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] items-center gap-2 py-3 border-b border-slate-100">
                    <span className="text-[12px] font-bold text-slate-400">신청 수량</span>
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-indigo-400 transition-colors">
                      <input type="number" min="1" max={selectedItem.current_stock} value={reqForm.qty} onChange={(e) => setReqForm({...reqForm, qty: Number(e.target.value)})} className="w-full bg-transparent text-sm font-black text-indigo-600 outline-none" />
                      {sUnit && <span className="text-[11px] font-black text-slate-400">{sUnit}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 pt-3">
                    <span className="text-[12px] font-bold text-slate-400">비고 및 전달사항</span>
                    <textarea value={reqForm.note} onChange={(e) => setReqForm({...reqForm, note: e.target.value})} placeholder="상세 용도나 요청사항을 적어주세요." className="w-full p-4 border border-slate-200 rounded-2xl text-[13px] font-bold outline-none focus:border-indigo-500 bg-slate-50/50 h-24 resize-none transition-colors shadow-inner" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setSelectedItem(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl text-[13px] font-black text-slate-500 hover:bg-slate-200 transition-colors">취소</button>
                  <button onClick={handleRequestSubmit} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl text-[13px] font-black hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95">신청 완료</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}