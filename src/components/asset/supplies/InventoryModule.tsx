'use client';
     
import React, { useState, useEffect } from 'react';
     
export default function InventoryModule() {
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // 팝업 관련 State
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [reqForm, setReqForm] = useState({ qty: 1, note: '' });
     
  useEffect(() => { fetchItems(); }, []);
     
  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/asset/supplies/inventory', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setCurrentUser(data.user || null);
      }
    } catch (e) { console.error("데이터 로드 실패"); }
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
     
  if (loading) return <div className="p-20 text-center font-black text-indigo-600 animate-pulse text-xl tracking-widest uppercase">Loading Inventory Catalog...</div>;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 🚀 1. 메인 정보성 대시 배너 (UI 표준 지침 적용) */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">
            General Office Supplies
          </p>
          <h1 className="text-2xl font-black tracking-tight">
            소모품 재고 및 신청
          </h1>
          <p className="text-blue-100 text-xs font-semibold mt-1 opacity-90">
            사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고 필요 물품을 신청합니다.
          </p>
        </div>
        {/* 배경 장식용 아이콘 */}
        <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none">
          📦
        </div>
      </div>
     
      {/* 🚀 2. 통합 카탈로그 컨테이너 (데이터시트 외곽선 표준 차용) */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6">
        
        {/* HeaderLight 규격 적용 */}
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">비품 카탈로그</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{items.length}개 품목</span>
          </div>
        </div>

        {/* 🚀 3. 심플 카드 그리드 영역 */}
        <div className="p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {items.map(item => {
              const ext = item.description ? JSON.parse(item.description) : {};
              const isOut = item.current_stock <= 0;
         
              return (
                <div key={item.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
                  
                  {/* 🚀 사진 꽉 차게 통일 (object-cover) */}
                  <div className="h-52 bg-slate-50 relative overflow-hidden flex justify-center items-center border-b border-slate-100">
                    {item.image_url ? (
                      <img 
                        src={item.image_url} 
                        alt={item.name} 
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                      />
                    ) : (
                      <div className="text-slate-200 text-6xl">📦</div>
                    )}
                    {/* 품절 뱃지 오버레이 */}
                    {isOut && (
                      <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center z-10">
                        <span className="bg-slate-900 text-white font-black px-4 py-1.5 rounded-full text-xs shadow-lg uppercase tracking-widest">Out of Stock</span>
                      </div>
                    )}
                  </div>
         
                  {/* 정보 영역 */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-black text-slate-800 text-[13px] mb-3 leading-snug line-clamp-2">{item.name}</h4>
                      
                      {/* 🚀 용어 변경 (In Stock) 및 디자인 정돈 */}
                      <div className="flex justify-between items-center mb-5">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider">In Stock</span>
                        <span className="text-sm font-black text-indigo-600 font-mono">
                          {item.current_stock.toLocaleString()} <span className="text-[9px] text-slate-400 uppercase ml-0.5">{ext.s_unit || 'EA'}</span>
                        </span>
                      </div>
                    </div>
         
                    <button 
                      onClick={() => openPopup(item)}
                      disabled={isOut}
                      className={`w-full py-3 rounded-2xl text-[11px] font-black tracking-wide uppercase transition-all ${
                        isOut 
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                          : 'bg-slate-900 text-white hover:bg-blue-600 shadow-md active:scale-95'
                      }`}
                    >
                      {isOut ? '품절 (신청불가)' : '신청하기'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {items.length === 0 && (
            <div className="py-20 text-center text-slate-400 font-black">
              등록된 소모품 품목이 없습니다.
            </div>
          )}
        </div>
      </div>
     
      {/* 🚀 4. 미니멀 신청 팝업 (모달) */}
      {selectedItem && (
        <div className="fixed inset-0 z-[500] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8">
            
            {/* 팝업 헤더 */}
            <div className="bg-slate-900 p-5 flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase tracking-widest">신청서 작성</h3>
              <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-white transition-colors">✕</button>
            </div>

            <div className="p-7 space-y-6">
              {/* 물품명 강조 */}
              <div className="text-center">
                <h4 className="font-black text-base text-slate-900 leading-tight">{selectedItem.name}</h4>
                <p className="text-[10px] text-indigo-500 font-bold mt-1">현재고: {selectedItem.current_stock.toLocaleString()} {JSON.parse(selectedItem.description || '{}').s_unit || 'EA'}</p>
              </div>
     
              {/* 입력 섹션 (군더더기 폼 제거) */}
              <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">신청 수량 (Quantity)</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" min="1" max={selectedItem.current_stock}
                      value={reqForm.qty}
                      onChange={(e) => setReqForm({...reqForm, qty: Number(e.target.value)})}
                      className="flex-1 p-2 bg-white border border-slate-200 rounded-xl text-sm font-black text-center text-indigo-600 outline-none focus:border-indigo-500 transition-colors"
                    />
                    <span className="font-black text-slate-500 text-[10px] w-6">{JSON.parse(selectedItem.description || '{}').s_unit || 'EA'}</span>
                  </div>
                </div>
     
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2 px-1">비고 및 전달사항 (Note)</label>
                  <textarea 
                    value={reqForm.note}
                    onChange={(e) => setReqForm({...reqForm, note: e.target.value})}
                    placeholder="용도나 전달사항을 적어주세요."
                    className="w-full p-4 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:border-indigo-500 bg-slate-50/50 h-24 resize-none transition-colors"
                  />
                </div>
              </div>
     
              {/* 하단 버튼 5:5 비율 */}
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setSelectedItem(null)} 
                  className="flex-1 py-3.5 bg-slate-100 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={handleRequestSubmit} 
                  className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl text-[11px] font-black hover:bg-blue-700 shadow-md transition-all active:scale-95"
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