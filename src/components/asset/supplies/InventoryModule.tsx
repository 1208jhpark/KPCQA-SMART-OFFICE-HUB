// src/components/asset/supplies/InventoryModule.tsx
'use client';
     
import React, { useState, useEffect, useMemo } from 'react';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/supplies/inventory';
     
export default function InventoryModule() {
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [reqForm, setReqForm] = useState<{ qty: number | ''; note: string }>({ qty: 1, note: '' });
  const [submitting, setSubmitting] = useState(false);

  const editState = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig),
    [currentUser, interfaceConfig]
  );
  const canApply = editState.isEditor;
     
  useEffect(() => { 
    const initLoad = async () => {
      setLoading(true);
      await Promise.all([fetchAuthContext(), syncItemsOnly()]);
      setLoading(false);
    };
    initLoad();
  }, []);
     
  const fetchAuthContext = async () => {
    const ts = Date.now();
    try {
      const [userRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (userRes.ok) setCurrentUser(await userRes.json());
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/supplies/inventory'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
    } catch (e) {
      console.error("유저/권한 정보 로드 실패:", e);
    }
  };

  const syncItemsOnly = async (): Promise<any[]> => {
    try {
      const itemRes = await fetch(`/api/asset/supplies/inventory?t=${Date.now()}`, { cache: 'no-store' });
      if (itemRes.ok) {
        const itemData = await itemRes.json();
        const nextItems = itemData.items || [];
        setItems(nextItems);
        return nextItems;
      } else if (itemRes.status === 401 || itemRes.status === 403) {
        const err = await itemRes.json().catch(() => ({}));
        alert(err.error || '소모품 목록을 볼 권한이 없습니다.');
      }
    } catch (e) {
      console.error("실시간 재고 동기화 실패:", e);
    }
    return [];
  };
     
  const openPopup = (item: any) => {
    if (!canApply) {
      return alert('신청 권한이 없습니다.\nadmin/interface에서 해당 메뉴 Edit 권한을 확인하세요.');
    }
    setSelectedItem(item);
    setReqForm({ qty: 1, note: '' });
  };
     
  const handleRequestSubmit = async () => {
    if (submitting) return;
    if (!canApply) return alert('신청 권한이 없습니다. (Edit 필요)');
    if (!currentUser?.id) return alert('로그인 정보가 없습니다. 새로고침 후 다시 시도해 주세요.');

    const qty = typeof reqForm.qty === 'number' ? reqForm.qty : NaN;
    if (!Number.isInteger(qty) || qty <= 0) return alert('신청 수량은 1 이상의 정수만 가능합니다.');
    if (qty > Number(selectedItem.current_stock)) return alert('현재고보다 많이 신청할 수 없습니다.');
    
    setSubmitting(true);

    const itemId = selectedItem.id;

    setItems(prevItems => prevItems.map(item =>
      item.id === itemId
        ? { ...item, current_stock: Math.max(0, Number(item.current_stock) - qty) }
        : item
    ));
    setSelectedItem((prev: any) =>
      prev?.id === itemId
        ? { ...prev, current_stock: Math.max(0, Number(prev.current_stock) - qty) }
        : prev
    );

    const syncModalStock = (freshItems: any[]) => {
      if (!freshItems.length) return;
      const fresh = freshItems.find((i) => i.id === itemId);
      if (!fresh) {
        setSelectedItem(null);
        return;
      }
      setSelectedItem((prev: any) =>
        prev?.id === itemId ? { ...prev, current_stock: fresh.current_stock } : prev
      );
      if (Number(fresh.current_stock) <= 0) {
        setReqForm((f) => ({ ...f, qty: 1 }));
      } else {
        setReqForm((f) => ({
          ...f,
          qty: Math.min(Number(f.qty) || 1, Number(fresh.current_stock)),
        }));
      }
    };

    try {
      const payload = {
        item_id: itemId,
        qty: qty,
        note: reqForm.note,
      };

      const res = await fetch('/api/asset/supplies/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert('✅ 정상적으로 신청이 완료되었습니다.\n(신청 수량만큼 재고가 우선 차감되었습니다.)');
        setSelectedItem(null);
        await syncItemsOnly();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 서버에서 신청을 거부했습니다.\n${err.error || '알 수 없는 오류'}`);
        const freshItems = await syncItemsOnly();
        syncModalStock(freshItems);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
      const freshItems = await syncItemsOnly();
      syncModalStock(freshItems);
    } finally {
      setSubmitting(false);
    }
  };
     
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (item.is_active === false) return false;
      if (item.is_published === false) return false;
      if (searchQuery && !item.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [items, searchQuery]);
     
  if (loading) return <LoadingState />;
     
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
        <div className="absolute right-0 top-0 w-64 h-64 bg-sky-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-indigo-900/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-2.5">
            GENERAL OFFICE SUPPLIES
          </h3>
          <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
            소모품 조회 및 신청 대장
          </h1>
          <p className="text-white/70 text-xs mt-3 leading-relaxed">
            경영기획센터에서 중앙 관리하는 사내 공통 소모품과 일반 비품의 실시간 재고를 파악하고 신청합니다.
          </p>
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
                let publishNote = '';
                try {
                  const ext = item.description ? JSON.parse(item.description) : {};
                  rUnit = ext.s_unit || ext.r_unit || '';
                  publishNote = String(ext.publish_note || '').trim();
                } catch (e) {}
     
                const currentStock = Number(item.current_stock) || 0;
                const isOut = currentStock <= 0;
                const applyDisabled = isOut || !canApply;
          
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
                      <span
                        className="text-[9px] text-slate-400 font-bold mb-3 truncate normal-case tracking-normal"
                        title={publishNote || undefined}
                      >
                        {publishNote || '\u00A0'}
                      </span>
                      
                      <div className="mt-auto flex flex-col gap-2 pt-3 border-t border-slate-50">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-black text-slate-400">현재고</span>
                          <span className={`font-mono font-black text-sm leading-none ${isOut ? 'text-slate-400' : 'text-indigo-600'}`}>
                            {currentStock.toLocaleString()} {rUnit && <span className="text-[9px] font-sans text-slate-500 ml-0.5">{rUnit}</span>}
                          </span>
                        </div>
                        <button 
                          onClick={() => openPopup(item)} disabled={applyDisabled}
                          title={!canApply ? 'Edit 권한 필요' : isOut ? '품절' : '신청하기'}
                          className={`w-full py-1.5 rounded-lg text-[10px] font-black tracking-wide uppercase transition-all shadow-sm ${
                            applyDisabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' : 'bg-slate-900 text-white hover:bg-blue-600 active:scale-95'
                          }`}
                        >
                          {isOut ? '불가' : !canApply ? '권한없음' : '신청하기'}
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
     
      {selectedItem && canApply && (() => {
        let sUnit = '';
        let publishNote = '';
        try {
          const ext = selectedItem.description ? JSON.parse(selectedItem.description) : {};
          sUnit = ext.s_unit || ext.r_unit || '';
          publishNote = String(ext.publish_note || '').trim();
        } catch (e) {}
     
        return (
          <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-12 duration-500">
              <div className="bg-gradient-to-r from-blue-700 to-indigo-800 px-6 py-5 flex justify-between items-center text-white shadow-md">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">SUPPLY REQUEST</p>
                  <h3 className="text-base font-extrabold tracking-tight text-white">소모품 신청서 작성</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
                  aria-label="닫기"
                >
                  ✕
                </button>
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
                  {publishNote ? (
                    <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-start">
                      <span className="text-[12px] font-bold text-slate-400">설명</span>
                      <span className="text-[12px] font-bold text-slate-600 leading-snug">{publishNote}</span>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[90px_1fr] gap-2 py-2 border-b border-slate-100 items-center">
                    <span className="text-[12px] font-bold text-slate-400">현재고</span>
                    <span className="text-[13px] font-mono font-black text-indigo-600">{Number(selectedItem.current_stock).toLocaleString()} {sUnit && <span className="text-[11px] font-sans text-slate-400 ml-1">{sUnit}</span>}</span>
                  </div>
                  <div className="grid grid-cols-[90px_1fr] items-center gap-2 py-3 border-b border-slate-100">
                    <span className="text-[12px] font-bold text-slate-400">신청 수량</span>
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:border-indigo-400 transition-colors">
                      <input
                        type="number"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        step={1}
                        min={1}
                        max={Number(selectedItem.current_stock) || 1}
                        value={reqForm.qty}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setReqForm({ ...reqForm, qty: '' });
                            return;
                          }
                          const digits = raw.replace(/[^\d]/g, '');
                          if (!digits) {
                            setReqForm({ ...reqForm, qty: '' });
                            return;
                          }
                          const n = parseInt(digits, 10);
                          const maxStock = Math.max(1, Number(selectedItem.current_stock) || 1);
                          setReqForm({ ...reqForm, qty: Math.min(Math.max(1, n), maxStock) });
                        }}
                        onBlur={() => {
                          if (reqForm.qty === '' || !Number.isInteger(reqForm.qty) || reqForm.qty < 1) {
                            setReqForm({ ...reqForm, qty: 1 });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (['.', ',', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                        }}
                        className="w-full bg-transparent text-sm font-black text-indigo-600 outline-none"
                      />
                      {sUnit && <span className="text-[11px] font-black text-slate-400">{sUnit}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 pt-3">
                    <span className="text-[12px] font-bold text-slate-400">비고 및 전달사항</span>
                    <textarea value={reqForm.note} onChange={(e) => setReqForm({...reqForm, note: e.target.value})} placeholder="상세 용도나 요청사항을 적어주세요." className="w-full p-4 border border-slate-200 rounded-2xl text-[13px] font-bold outline-none focus:border-indigo-500 bg-slate-50/50 h-24 resize-none transition-colors shadow-inner" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" disabled={submitting} onClick={() => setSelectedItem(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl text-[13px] font-black text-slate-500 hover:bg-slate-200 transition-colors disabled:opacity-50">취소</button>
                  <button type="button" disabled={submitting} onClick={handleRequestSubmit} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl text-[13px] font-black hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">{submitting ? '신청 중…' : '신청 완료'}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
