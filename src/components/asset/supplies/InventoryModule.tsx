'use client';

import React, { useState, useEffect, useMemo } from 'react';

export default function InventoryModule() {
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // 검색 필터링 State
  const [searchQuery, setSearchQuery] = useState('');
  
  // 팝업 관련 State
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [reqForm, setReqForm] = useState({ qty: 1, note: '' });

  useEffect(() => { fetchItems(); }, []);

  // 🚀 API 호출 및 완벽한 캐시 무력화 (하드코딩 없음)
  const fetchItems = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const fetchOptions = {
        cache: 'no-store' as RequestCache,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      };

      const [itemRes, userRes] = await Promise.all([
        fetch('/api/asset/supplies/inventory?t=' + ts, fetchOptions),
        fetch('/api/auth/me?t=' + ts, fetchOptions)
      ]);

      if (itemRes.ok) {
        const itemData = await itemRes.json();
        setItems(itemData.items || []);
      }
      
      if (userRes.ok) {
        const userData = await userRes.json();
        setCurrentUser(userData || null); 
      }
    } catch (e) { 
      console.error("데이터 로드 실패:", e); 
    }
    setLoading(false);
  };

  const openPopup = (item: any) => {
    setSelectedItem(item);
    setReqForm({ qty: 1, note: '' });
  };

  const handleRequestSubmit = async () => {
    const qty = Number(reqForm.qty) || 1;
    if (qty <= 0) return alert('1개 이상 신청해주세요.');
    if (qty > selectedItem.current_stock) return alert('현재고보다 많이 신청할 수 없습니다.');
    
    const res = await fetch('/api/asset/supplies/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: selectedItem.id, qty, note: reqForm.note })
    });

    if (res.ok) {
      alert('신청이 완료되었습니다.');
      setSelectedItem(null);
      fetchItems(); 
    } else { alert('신청 중 오류가 발생했습니다.'); }
  };

  // 검색어 기반 필터링 연산
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, searchQuery]);

  if (loading) return <div className="p-20 text-center font-black text-indigo-600 animate-pulse text-xl tracking-widest uppercase">Loading Inventory Master...</div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 메인 정보성 대시 배너 */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">
            General Office Supplies
          </p>
          <h1 className="text-2xl font-black tracking-tight">
            소모품 조회 및 신청 대장
          </h1>
          <p className="text-blue-100 text-xs font-semibold mt-1 opacity-90">
            경영기획실에서 중앙 관리하는 사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고 신청합니다.
          </p>
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none">
          📦
        </div>
      </div>

      {/* 통합 카탈로그 리스트 (테이블형) */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">비품 청구 리스트</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredItems.length}개 품목</span>
          </div>

          <div className="relative w-full sm:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            <input 
              type="text" 
              placeholder="물품명 검색..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none focus:border-indigo-500 transition-colors shadow-sm"
            />
          </div>
        </div>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="py-4 px-6 w-16 text-center">사진</th>
                <th className="py-4 px-4 w-auto">물품명</th>
                <th className="py-4 px-4 w-32 text-right">보유 재고</th>
                <th className="py-4 px-4 w-28 text-center">상태</th>
                <th className="py-4 px-6 w-32 text-center">신청 관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm font-bold text-slate-700">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-slate-400 text-xs font-bold bg-white">
                    {searchQuery ? '검색된 품목이 없습니다.' : '등록된 소모품 품목이 없습니다.'}
                  </td>
                </tr>
              ) : filteredItems.map(item => {
                const ext = item.description ? JSON.parse(item.description) : {};
                const isOut = item.current_stock <= 0;
          
                return (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors bg-white group">
                    <td className="py-3 px-6 text-center">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden mx-auto flex items-center justify-center shrink-0 shadow-sm">
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                        ) : (
                          <span className="text-lg opacity-40">📦</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className={`text-[13px] font-black ${isOut ? 'text-slate-400 line-through opacity-70' : 'text-slate-800'}`}>
                          {item.name}
                        </span>
                        <span className="text-[9px] text-slate-400 font-bold mt-0.5 uppercase tracking-wider">{item.category || '일반 비품'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-mono font-black text-sm ${isOut ? 'text-slate-400' : 'text-indigo-600'}`}>
                        {item.current_stock.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1 font-sans">{ext.s_unit || 'EA'}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {isOut ? (
                        <span className="inline-block px-2.5 py-1 bg-red-50 text-red-500 border border-red-100 rounded-md text-[10px] font-black tracking-widest shadow-sm">품절</span>
                      ) : (
                        <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-md text-[10px] font-black tracking-widest shadow-sm">정상재고</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-center">
                      <button 
                        onClick={() => openPopup(item)}
                        disabled={isOut}
                        className={`w-full py-1.5 rounded-lg text-[11px] font-black tracking-wide uppercase transition-all ${
                          isOut 
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                            : 'bg-slate-800 text-white hover:bg-indigo-600 shadow-sm active:scale-95'
                        }`}
                      >
                        {isOut ? '불가' : '신청하기'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🚀 고도화된 신청 팝업 (모달) */}
      {selectedItem && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-12 duration-500">
            
            <div className="bg-slate-900 p-6 flex justify-between items-center text-white">
              <h3 className="text-sm font-black tracking-wide">소모품 신청서 작성</h3>
              <button onClick={() => setSelectedItem(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors">✕</button>
            </div>

            <div className="p-8 space-y-6">
              
              {/* 신청자 정보 */}
              <div className="space-y-1">
                <p className="text-[11px] font-black text-indigo-500 mb-3">신청자 정보</p>
                
                <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                  <span className="text-[12px] font-bold text-slate-400">신청 부서</span>
                  <span className="text-[13px] font-black text-slate-800">
                    {/* 🚀 하드코딩 제거: 가능한 모든 부서 매핑 경로를 탐색합니다 */}
                    {currentUser?.unit?.unit_name || currentUser?.dept || '소속 정보 없음'}
                  </span>
                </div>
                
                <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                  <span className="text-[12px] font-bold text-slate-400">신청인</span>
                  <span className="text-[13px] font-black text-slate-800">
                    {currentUser?.name || '사용자 정보 없음'} {currentUser?.email ? `(${currentUser.email.split('@')[0]})` : ''}
                  </span>
                </div>
              </div>

              {/* 물품 정보 및 입력 */}
              <div className="space-y-1">
                <p className="text-[11px] font-black text-indigo-500 mb-3 mt-2">물품 정보</p>
                
                <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                  <span className="text-[12px] font-bold text-slate-400">물품명</span>
                  <span className="text-[13px] font-black text-slate-900 leading-tight">{selectedItem.name}</span>
                </div>

                <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                  <span className="text-[12px] font-bold text-slate-400">현재고</span>
                  <span className="text-[13px] font-mono font-black text-indigo-600">
                    {selectedItem.current_stock.toLocaleString()} <span className="text-[11px] font-sans text-slate-400">{JSON.parse(selectedItem.description || '{}').s_unit || 'EA'}</span>
                  </span>
                </div>

                <div className="grid grid-cols-[90px_1fr] items-center gap-2 py-3 border-b border-slate-100">
                  <span className="text-[12px] font-bold text-slate-400">신청 수량</span>
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-indigo-400 transition-colors">
                    <input 
                      type="number" min="1" max={selectedItem.current_stock}
                      value={reqForm.qty}
                      onChange={(e) => setReqForm({...reqForm, qty: Number(e.target.value)})}
                      className="w-full bg-transparent text-sm font-black text-indigo-600 outline-none"
                    />
                    <span className="text-[11px] font-black text-slate-400">{JSON.parse(selectedItem.description || '{}').s_unit || 'EA'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-3">
                  <span className="text-[12px] font-bold text-slate-400">비고 및 전달사항</span>
                  <textarea 
                    value={reqForm.note}
                    onChange={(e) => setReqForm({...reqForm, note: e.target.value})}
                    placeholder="상세 용도나 요청사항을 적어주세요."
                    className="w-full p-4 border border-slate-200 rounded-2xl text-[13px] font-bold outline-none focus:border-indigo-500 bg-slate-50/50 h-24 resize-none transition-colors shadow-inner"
                  />
                </div>
              </div>

              {/* 하단 액션 버튼 */}
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setSelectedItem(null)} 
                  className="flex-1 py-4 bg-slate-100 rounded-2xl text-[13px] font-black text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={handleRequestSubmit} 
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl text-[13px] font-black hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95"
                >
                  신청 완료
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}