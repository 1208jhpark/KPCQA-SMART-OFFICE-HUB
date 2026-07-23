// src/components/asset/supplies/MasterDashboardModule.tsx
'use client';
     
import React, { useState, useEffect, useMemo, Suspense, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
import { isPendingSupplyRequest } from '@/utils/supplyRequestStatus';
     
function SuppliesMasterDashboardContent({ currentUser: propUser }: { currentUser?: any }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(propUser || null);
  
  const [config, setConfig] = useState<any>(null);
  const [masterData, setMasterData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
     
  const [editModal, setEditModal] = useState<any | null>(null);
  const [stockInModal, setStockInModal] = useState<any | null>(null);
  const [statFilter, setStatFilter] = useState<'ALL' | 'PENDING' | 'WARNING' | 'OUT'>('ALL'); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
     
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [dashRes, reqRes, confRes, mastRes, userRes] = await Promise.all([
        fetch(`/api/asset/supplies/master/dashboard?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }),
        !propUser ? fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) : Promise.resolve(null)
      ]);
     
      if (dashRes.ok) {
        const data = await dashRes.json();
        setItems(data.items || []);
      } else if (dashRes.status === 401 || dashRes.status === 403) {
        const err = await dashRes.json().catch(() => ({}));
        alert(err.error || '마스터 대시보드 권한이 없습니다.');
      }

      if (reqRes.ok) setRequests(await reqRes.json());
      if (confRes.ok) setConfig(await confRes.json());
      if (mastRes.ok) setMasterData(await mastRes.json());
      
      if (!propUser && userRes?.ok) {
        setCurrentUser(await userRes.json());
      }
    } catch (e) {
      console.error("Master Dashboard Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
     
  useEffect(() => {
    fetchDashboardData();
  }, []);
     
  const stats = useMemo(() => {
    const activeItems = items.filter(i => i.is_active !== false); 
    const totalItems = activeItems.length;
    
    const warningCount = activeItems.filter(item => Number(item.current_stock) <= Number(item.alert_qty || 5) && Number(item.current_stock) > 0).length;
    const outOfStockCount = activeItems.filter(item => Number(item.current_stock) === 0).length;
    
    const pendingReqs = requests.filter(r => isPendingSupplyRequest(r.status)).length;
    return { totalItems, warningCount, outOfStockCount, pendingReqs };
  }, [items, requests]);
     
  const filteredItems = useMemo(() => {
    let list = items.filter(i => i.is_active !== false);
    
    if (statFilter === 'WARNING') {
      list = list.filter(i => Number(i.current_stock) <= Number(i.alert_qty || 5) && Number(i.current_stock) > 0);
    } else if (statFilter === 'OUT') {
      list = list.filter(i => Number(i.current_stock) === 0);
    } else if (statFilter === 'PENDING') {
      const pendingItemIds = new Set(requests.filter(r => isPendingSupplyRequest(r.status)).map(r => r.item_id));
      list = list.filter(i => pendingItemIds.has(i.id));
    }
    
    return list.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  }, [items, requests, statFilter]);
  
  const supplyOptions = useMemo(() => {
    if (!config?.supply_category_group || !masterData.length) return [];
    const group = masterData.find(g => g.id === config.supply_category_group);
    return group?.codes?.filter((c: any) => c.is_active && !c.is_archived) || [];
  }, [config, masterData]);
     
  const unitOptions = useMemo(() => {
    if (!config?.unit_category_group || !masterData.length) return [];
    const group = masterData.find(g => g.id === config.unit_category_group);
    return group?.codes?.filter((c: any) => c.is_active && !c.is_archived) || [];
  }, [config, masterData]);
  
  const formatNum = (num: any) => Number(num || 0).toLocaleString();
  
  const handleAddNewClick = () => {
    setEditModal({
      isNew: true, 
      id: `SUP-${Date.now().toString().slice(-4)}`, 
      name: supplyOptions[0]?.label || '', 
      current_stock: 0, 
      alert_qty: 5, 
      p_unit: unitOptions[0]?.label || 'BOX', 
      r_unit: unitOptions[0]?.label || 'EA',  
      note: '', 
      image_url: ''
    });
  };
     
  const handleEditClick = (item: any) => {
    const ext = item.description ? JSON.parse(item.description) : {};
    setEditModal({
      isNew: false, 
      id: item.id, 
      name: item.name, 
      current_stock: Number(item.current_stock), 
      alert_qty: Number(item.alert_qty) || 5, 
      p_unit: ext.p_unit || 'BOX', 
      r_unit: ext.s_unit || ext.r_unit || 'EA', 
      note: ext.note || '', 
      image_url: item.image_url || ''
    });
  };
     
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) return alert("이미지 용량은 2MB를 초과할 수 없습니다.");
      const reader = new FileReader();
      reader.onloadend = () => setEditModal((prev: any) => ({ ...prev, image_url: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };
     
  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.name.trim()) return alert('품목명을 선택/입력해주세요.');
    if (!editModal.id.trim()) return alert('품목코드를 입력해주세요.');
     
    const payload = {
      id: editModal.id.trim(), 
      name: editModal.name,
      current_stock: Number(editModal.current_stock) || 0,
      alert_qty: Number(editModal.alert_qty) || 0,
      category: '소모품',
      p_unit: editModal.p_unit,
      s_unit: editModal.r_unit,
      p_qty: 1, 
      sub_qty: editModal.isNew ? (Number(editModal.current_stock) || 1) : 1,
      batch_price: 0,
      vendor: '',
      image_url: editModal.image_url || '',
      note: editModal.note || '' 
    };
     
    try {
      const res = await fetch('/api/asset/supplies/master/dashboard', {
        method: editModal.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert(editModal.isNew ? '✅ 신규 품목이 서버에 등록되었습니다.' : '✅ 정보가 서버에 성공적으로 수정되었습니다.');
        setEditModal(null);
        fetchDashboardData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 저장 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
    }
  };
     
  // 🚀 [정밀 튜닝 완료] 입고 승인 시 꼬이는 데이터 포맷 전면 재배치
  const handleStockInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(stockInModal.qty) || 0;
    const basePrice = Number(stockInModal.base_price) || 0; // 순수 개당 단가
    const extraCost = Number(stockInModal.extra_cost) || 0;
     
    if (qty <= 0) return alert('입고 수량을 1개 이상 입력하세요.');
    
    // (순수 물품 총 비용) + 부대비용 = 실제 결산 금액 총액
    const calculatedTotal = (qty * basePrice) + extraCost;
     
    const payload = {
      item_id: stockInModal.id,
      qty: qty,
      unit_price: basePrice,
      total_price: calculatedTotal,
      extra_cost: extraCost,
      purchase_date: stockInModal.stock_in_date,
      vendor: stockInModal.vendor,
      note: stockInModal.note || '대시보드 직접 입고'
    };
     
    try {
      const res = await fetch('/api/asset/supplies/master/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
     
      if (res.ok) {
        alert(`✅ 서버 입고 처리 완료!\n재고가 +${qty}개 증가했으며 입고 대장에 기록되었습니다.`);
        setStockInModal(null);
        fetchDashboardData();
      } else {
        const err = await res.json();
        alert(`입고 실패: ${err.error}`);
      }
    } catch (error) {
      alert('입고 통신 에러가 발생했습니다.');
    }
  };
     
  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    if (!confirm(nextStatus ? '해당 물품을 사용자 앱에 [게시올리기] 하시겠습니까?' : '사용자 앱에서 [게시내리기] 처리하시겠습니까?')) return;
    
    setItems(prev => prev.map(item => item.id === id ? { ...item, is_published: nextStatus } : item));
     
    try {
      const res = await fetch('/api/asset/supplies/master/dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_published: nextStatus })
      });
      if (res.ok) {
        fetchDashboardData();
      } else {
        alert("상태 변경 실패. 서버 오류입니다.");
        fetchDashboardData(); 
      }
    } catch (e) { 
      alert("상태 변경 통신 실패");
      fetchDashboardData();
    }
  };
     
  const handleArchive = async (id: string) => {
    const reason = prompt('보관함으로 이동합니다.\n보관(폐기) 사유를 명확히 입력해주세요:');
    if (reason === null || reason.trim() === '') return alert('사유가 입력되지 않아 취소되었습니다.');
    
    try {
      const payload = {
        id,
        is_active: false,
        disposal_date: new Date().toISOString(),
        disposal_reason: reason.trim(),
      };
     
      const res = await fetch('/api/asset/supplies/master/dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert('보관함으로 성공적으로 이동되었습니다.');
        fetchDashboardData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '아카이브 처리 실패');
      }
    } catch (e) { alert("아카이브 처리 실패"); }
  };
     
  const handleDeleteItem = async (id: string) => {
    const isLv1 = currentUser?.roles?.includes('LV_1') || currentUser?.role === 'LV_1';
    if (!isLv1) return alert('영구 삭제 권한이 없습니다. (LV_1 전용)');
    if (!confirm('경고: 이 품목을 대장에서 영구 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.')) return;
    
    try {
      const res = await fetch(`/api/asset/supplies/master/dashboard?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('서버에서 완전히 삭제되었습니다.');
        fetchDashboardData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`삭제 불가: ${err.error || '권한을 확인하세요.'}`);
      }
    } catch (e) { alert('삭제 통신 실패'); }
  };
     
  if (loading) return <div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest text-xl">Loading Master Workspace...</div>;
     
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* 🚀 소모품 마스터 관리 통제실 (명함 배너와 100% 스타일 싱크로율 매칭) */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 p-6 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden flex flex-col justify-center min-h-[140px]">
  
  <div className="relative z-10 flex justify-between items-end w-full">
    <div>
      {/* 1. 상단 라벨 (mb-3 여백 및 명함과 동일한 텍스트 톤) */}
      <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">
        CENTRAL SUPPLIES CONTROL TOWER
      </h3>
      
      {/* 2. 메인 타이틀 (leading-none으로 라인 꼬임 방지) */}
      <h1 className="text-2xl font-black tracking-tight text-white leading-none">
        소모품 마스터 관리 통제실
      </h1>
      
      {/* 3. 하단 설명 (mt-4 표준 간격 적용) */}
      <p className="text-emerald-100/90 text-xs font-semibold mt-4 opacity-90">
        전사 소모품의 전체 관리 및 실시간 재고 현황을 모니터링하고 관리합니다.
      </p>
    </div>
  </div>

  {/* 우측 관제실 느낌의 은은한 엠블럼 배치 (공백 완벽 메꿈) */}
  <div className="absolute right-10 top-1/2 -translate-y-1/2 text-8xl opacity-10 select-none pointer-events-none">
    📊
  </div>
</div>
      
      {/* 탭 메뉴 */}
      <div className="flex gap-1.5 bg-slate-200/60 p-1.5 rounded-2xl border border-slate-200 shadow-inner w-full max-w-4xl">
        {tabItems.map((tab) => {
          const isActive = pathname.startsWith(tab.path);
          return (
            <Link key={tab.id} href={tab.path} className={`flex-1 py-3 text-center text-[11px] font-black rounded-xl transition-all uppercase tracking-tight ${isActive ? 'bg-white text-blue-600 shadow-sm border border-slate-300/50 scale-[1.01]' : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'}`}>
              {tab.name}
            </Link>
          );
        })}
      </div>

     
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4">
        <div onClick={() => setStatFilter('ALL')} className={`cursor-pointer border p-6 shadow-sm rounded-[2rem] flex flex-col justify-center transition-all hover:shadow-md ${statFilter === 'ALL' ? 'bg-slate-800 border-slate-900 text-white scale-105' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
          <p className={`text-[11px] font-black uppercase tracking-widest mb-1 ${statFilter === 'ALL' ? 'text-slate-300' : 'text-slate-400'}`}>총 운용 품목</p>
          <p className="text-3xl font-black tracking-tighter">{stats.totalItems} <span className="text-xs font-bold ml-1 opacity-50">EA</span></p>
        </div>
        <div onClick={() => router.push('/asset/supplies/master/requests')} className="cursor-pointer border p-6 shadow-sm rounded-[2rem] flex flex-col justify-center transition-all hover:shadow-md bg-blue-50 border-blue-100 hover:bg-blue-100">
          <p className="text-[11px] font-black uppercase tracking-widest mb-1 flex justify-between text-blue-500">
            <span>대기중인 신청 바로가기</span>
            {stats.pendingReqs > 0 && <span className="animate-pulse">🔔</span>}
          </p>
          <p className="text-3xl font-black tracking-tighter text-blue-600">
            {stats.pendingReqs} <span className="text-xs font-bold ml-1 opacity-50">건</span>
          </p>
        </div>
        <div onClick={() => setStatFilter('WARNING')} className={`cursor-pointer border p-6 shadow-sm rounded-[2rem] flex flex-col justify-center transition-all hover:shadow-md ${statFilter === 'WARNING' ? 'bg-orange-500 border-orange-600 text-white scale-105' : 'bg-orange-50 border-orange-100 hover:bg-orange-100'}`}>
          <p className={`text-[11px] font-black uppercase tracking-widest mb-1 ${statFilter === 'WARNING' ? 'text-orange-100' : 'text-orange-500'}`}>재고 경고 (발주요망)</p>
          <p className={`text-3xl font-black tracking-tighter ${statFilter === 'WARNING' ? 'text-white' : 'text-orange-600'}`}>{stats.warningCount} <span className="text-xs font-bold ml-1 opacity-50">품목</span></p>
        </div>
        <div onClick={() => setStatFilter('OUT')} className={`cursor-pointer border p-6 shadow-sm rounded-[2rem] flex flex-col justify-center transition-all hover:shadow-md ${statFilter === 'OUT' ? 'bg-red-600 border-red-700 text-white scale-105' : 'bg-red-50 border-red-100 hover:bg-red-100'}`}>
          <p className={`text-[11px] font-black uppercase tracking-widest mb-1 ${statFilter === 'OUT' ? 'text-red-200' : 'text-red-500'}`}>재고 품절</p>
          <p className={`text-3xl font-black tracking-tighter ${statFilter === 'OUT' ? 'text-white' : 'text-red-600'}`}>{stats.outOfStockCount} <span className="text-xs font-bold ml-1 opacity-50">품목</span></p>
        </div>
      </div>
     
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
            <h2 className="text-[13px] font-black text-slate-800 tracking-tight">
              {statFilter === 'ALL' ? '실시간 창고 재고 현황 보드' : 
               statFilter === 'PENDING' ? '신청 대기중인 물품 리스트' : 
               statFilter === 'WARNING' ? '재고 경고(부족) 물품 리스트' : '품절된 물품 리스트'}
            </h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredItems.length}개 품목</span>
            {statFilter !== 'ALL' && (
              <button onClick={() => setStatFilter('ALL')} className="ml-2 text-[10px] text-indigo-600 hover:underline font-bold">필터 초기화 ✕</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleAddNewClick} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700 transition-all shadow-sm flex items-center gap-1.5">
              + 신규 물품 추가
            </button>
          </div>
        </div>
     
        <div className="overflow-x-auto pb-4">
          <table className="w-full text-left border-collapse min-w-[2100px]">
          <thead>
              <tr className="text-[11px] font-black tracking-widest uppercase text-center border-b border-slate-200">
                <th colSpan={3} className="bg-slate-100 text-slate-600 py-3">품목 기본 정보</th>
                <th colSpan={7} className="bg-emerald-100 text-emerald-800 border-l-4 border-white py-3">💰 최근 입고 (결산) 이력 정보</th>
                <th colSpan={4} className="bg-blue-100 text-blue-800 border-l-4 border-white py-3">📦 창고 재고 현황</th>
                <th colSpan={2} className="bg-amber-100 text-amber-800 border-l-4 border-white py-3">🌐 사용자 앱 게시 설정</th>
                <th colSpan={1} className="bg-slate-800 text-white border-l-4 border-white py-3">액션 제어</th>
              </tr>
              <tr className="bg-slate-50 text-slate-700 text-[11px] font-bold border-b border-slate-200">
                <th className="h-10 px-4 w-12 text-center">NO</th>
                <th className="h-10 px-4 w-[220px]">품목명 (이미지)</th>
                <th className="h-10 px-4 w-32 text-center text-slate-500">품목코드</th>
                <th className="h-10 px-4 w-28 text-center border-l-4 border-white bg-emerald-50/50 text-slate-600">최근 입고일</th>
                <th className="h-10 px-4 w-32 text-center bg-emerald-50/50 text-emerald-700">구매처(벤더)</th>
                <th className="h-10 px-4 w-24 text-center bg-emerald-50/50 text-emerald-700">구매단위</th>
                <th className="h-10 px-4 w-24 text-center bg-emerald-50/50 text-emerald-700">입고수량</th>
                <th className="h-10 px-4 w-28 text-right bg-emerald-50/50 text-emerald-700">순수 단가(원)</th>
                <th className="h-10 px-4 w-28 text-right bg-emerald-50/50 text-orange-600">부대비용(원)</th>
                <th className="h-10 px-4 w-32 text-right bg-emerald-50/50 text-emerald-800 font-black">결산 총비용</th>
                <th className="h-10 px-4 w-24 text-center border-l-4 border-white bg-blue-50/30 text-blue-700">현재 재고</th>
                <th className="h-10 px-4 w-14 text-center bg-blue-50/30 text-slate-500">경고</th>
                <th className="h-10 px-4 w-36 text-center bg-blue-50/30 text-slate-600">재고 상태</th>
                <th className="h-10 px-4 w-40 bg-blue-50/30 text-slate-500">관리 비고(Note)</th>
                <th className="h-10 px-4 w-20 text-center border-l-4 border-white bg-amber-50/30 text-amber-700">신청단위</th>
                <th className="h-10 px-4 w-28 text-center bg-amber-50/30 text-amber-700">앱 노출 상태</th>
                <th className="h-10 px-4 w-[280px] text-center border-l-4 border-white bg-slate-100 text-slate-600">마스터 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {filteredItems.length === 0 ? (
                <tr><td colSpan={17} className="h-32 text-center text-slate-400 italic">조건에 맞는 데이터가 없습니다.</td></tr>
              ) : (
                filteredItems.map((item, idx) => {
                  const ext = item.description ? JSON.parse(item.description) : {};
                  const pUnit = ext.p_unit || 'BOX';
                  const rUnit = ext.s_unit || ext.r_unit || 'EA';
                  const note = ext.note || '-'; 
                  const safeStock = Number(item.alert_qty || 5); 
                  const currentStock = Number(item.current_stock || 0);
                  const isDanger = currentStock <= safeStock && currentStock > 0;
                  const isOut = currentStock === 0;
                  const isPublished = item.is_published !== false; 
                  
                  const lastPurchase = item.purchases?.[0] || {};
                  
                  // 🚀 [해결] note 문자열 포장지에 은닉된 부대비용을 역직렬화(Parse)하여 올바르게 분리 독립 표출
                  let extraCost = 0;
                  try { 
                    if (lastPurchase.note) {
                      // 만약 JSON 구조가 아니라면 catch문으로 우회하여 0원 방어
                      const parsed = JSON.parse(lastPurchase.note);
                      extraCost = Number(parsed.extra_cost) || 0; 
                    }
                  } catch(e){}
                  
                  const isLv1 = currentUser?.roles?.includes('LV_1') || currentUser?.role === 'LV_1';
                  const isRequested = (item.requests?.length || 0) > 0 || (item.purchases?.length || 0) > 0;
                  const disableDelete = isRequested && !isLv1;
     
                  return (
                    <tr key={item.id} className={`h-16 transition-colors ${isOut ? 'bg-red-50/30 hover:bg-red-50' : isDanger ? 'bg-orange-50/30 hover:bg-orange-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-4 flex items-center gap-3 h-16">
                        <div className="w-9 h-9 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-100 flex justify-center items-center">
                          {item.image_url ? <img src={item.image_url} alt="img" className="w-full h-full object-cover" /> : <span className="text-[11px] opacity-40">📦</span>}
                        </div>
                        <div className="font-black text-slate-900 text-xs truncate max-w-[150px]">{item.name}</div>
                      </td>
                      <td className="px-4 text-center font-mono text-slate-500">{item.id}</td>
                      
                      <td className="px-4 text-center border-l-4 border-slate-50 bg-emerald-50/10 font-mono text-slate-500">
                        {lastPurchase.purchase_date ? getKSTDateString(lastPurchase.purchase_date) : '-'}
                      </td>
                      
                      {/* 🚀 [해결] vendor 가 아닌 DB 실제 컬럼 매핑 규격인 old_vendor 를 추적하도록 바인딩 패치 */}
                      <td className="px-4 text-center bg-emerald-50/10 text-slate-600 truncate max-w-[120px]" title={lastPurchase.old_vendor}>{lastPurchase.old_vendor || '-'}</td>
                      
                      <td className="px-4 text-center bg-emerald-50/10 text-slate-500">{pUnit}</td>
                      <td className="px-4 text-center bg-emerald-50/10 text-emerald-600 font-black font-mono">{formatNum(lastPurchase.qty)}</td>
                      <td className="px-4 text-right bg-emerald-50/10 font-mono text-slate-600">{formatNum(lastPurchase.unit_price)}</td>
                      <td className="px-4 text-right bg-emerald-50/10 font-mono text-orange-600">{formatNum(extraCost)}</td>
                      <td className="px-4 text-right bg-emerald-50/10 font-black text-emerald-700 font-mono">{formatNum(lastPurchase.total_price)}</td>
     
                      <td className={`px-4 text-center border-l-4 border-slate-50 bg-blue-50/10 font-black text-xs ${isOut ? 'text-red-500' : isDanger ? 'text-orange-500' : 'text-blue-600'}`}>
                        {formatNum(currentStock)}
                      </td>
                      <td className="px-4 text-center bg-blue-50/10 text-slate-400 font-mono">{safeStock}</td>
                      <td className="px-4 text-center bg-blue-50/10">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${isOut ? 'bg-red-100 text-red-600 border border-red-200' : isDanger ? 'bg-orange-100 text-orange-600 border border-orange-200 animate-pulse' : 'bg-emerald-50 text-emerald-600'}`}>
                          {isOut ? '품절' : isDanger ? '재고부족' : '정상운용'}
                        </span>
                      </td>
                      <td className="px-4 bg-blue-50/10 text-indigo-700 font-bold truncate max-w-[250px]" title={note}>{note}</td>
                      
                      <td className="px-4 text-center border-l-4 border-slate-50 bg-amber-50/10 font-black text-amber-600">{rUnit}</td>
                      <td className="px-4 text-center bg-amber-50/10">
                        <button 
                          onClick={() => handleTogglePublish(item.id, isPublished)} 
                          className={`w-full py-1.5 rounded-md text-[10px] font-black shadow-sm transition-all border ${isPublished ? 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'}`}
                        >
                          {isPublished ? '⚫ 게시내리기' : '🟢 게시올리기'}
                        </button>
                      </td>
     
                      <td className="px-4 border-l-4 border-slate-50 bg-slate-50/30">
                      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          {/* 🚀 [해결] 입고 클릭 시 전달 인자도 vendor 가 아닌 old_vendor 백그라운드 매핑 연동 */}
                          <button onClick={() => setStockInModal({ 
                            id: item.id, name: item.name, vendor: lastPurchase.old_vendor || '', base_price: item.unit_price || 0, extra_cost: 0, qty: '', p_unit: pUnit,
                            purchase_date: getKSTDateString(),
                            stock_in_date: getKSTDateString()
                          })} className="px-2 py-1.5 rounded text-[10px] font-black bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition-colors">
                            📦입고
                          </button>
                          <button onClick={() => handleEditClick(item)} className="px-2 py-1.5 rounded text-[10px] font-black bg-white text-blue-600 border border-blue-200 shadow-sm hover:bg-blue-50 transition-colors">
                            ✏️수정
                          </button>
                          <button onClick={() => handleArchive(item.id)} className="px-2 py-1.5 rounded text-[10px] font-black bg-white text-slate-500 border border-slate-200 shadow-sm hover:bg-slate-100 transition-colors">
                            보관함
                          </button>
                          <button 
                            onClick={() => !disableDelete && handleDeleteItem(item.id)}
                            disabled={disableDelete}
                            title={disableDelete ? "신청 이력 존재. 일반 삭제 불가" : ""}
                            className={`px-2 py-1.5 rounded text-[10px] font-black shadow-sm transition-colors border ${disableDelete ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed' : 'bg-white text-red-500 border-red-200 hover:bg-red-50'}`}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
     
      {/* ✏️ 신규 등록/수정 모달 */}
      {editModal && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8">
            <div className="bg-slate-900 p-6 flex justify-between items-center text-white">
              <div>
                <h3 className="font-black text-[13px] uppercase tracking-widest text-white">
                  {editModal.isNew ? '✨ 신규 소모품 마스터 등록' : '✏️ 소모품 정보 수정'}
                </h3>
              </div>
              <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-white transition-colors text-xl">✕</button>
            </div>
     
            <form onSubmit={handleSaveSubmit} className="p-8 bg-slate-50 flex gap-8">
              <div className="w-1/3 flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">상품 이미지</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square border-2 border-dashed border-slate-300 rounded-2xl bg-white hover:bg-slate-50 transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative group"
                >
                  {editModal.image_url ? (
                    <>
                      <img src={editModal.image_url} alt="preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-white text-[10px] font-black">사진 변경</div>
                    </>
                  ) : (
                    <div className="text-center text-slate-400">
                      <div className="text-3xl mb-1">📸</div>
                      <span className="text-[10px] font-bold">클릭하여 등록</span>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageChange} className="hidden" />
                {editModal.image_url && (
                  <button type="button" onClick={() => setEditModal({...editModal, image_url: ''})} className="mt-1 text-[10px] text-red-500 font-bold hover:underline">사진 지우기</button>
                )}
                <p className="text-[8px] text-slate-400 text-center mt-2">최대 2MB 업로드 가능</p>
              </div>
     
              <div className="w-2/3 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">품목코드 (고유ID)</label>
                    <input 
                      type="text" required disabled={!editModal.isNew} value={editModal.id} onChange={(e) => setEditModal({...editModal, id: e.target.value})}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-900 outline-none focus:border-indigo-500 shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">품목명 (Master)</label>
                    {supplyOptions.length > 0 ? (
                      <select required value={editModal.name} onChange={(e) => setEditModal({...editModal, name: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-indigo-700 outline-none focus:border-indigo-500 shadow-sm">
                        <option value="">품목 선택</option>
                        {supplyOptions.map((opt:any) => <option key={opt.id} value={opt.label}>{opt.label}</option>)}
                      </select>
                    ) : (
                      <input type="text" required value={editModal.name} onChange={(e) => setEditModal({...editModal, name: e.target.value})} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-900 outline-none shadow-sm" placeholder="직접 입력" />
                    )}
                  </div>
                </div>
     
                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block mb-1.5">입고(구매) 단위</label>
                    {unitOptions.length > 0 ? (
                      <select required value={editModal.p_unit} onChange={(e) => setEditModal({...editModal, p_unit: e.target.value})} className="w-full p-2.5 bg-white border border-emerald-200 rounded-lg text-[11px] font-black text-slate-700 outline-none focus:border-emerald-500 shadow-sm">
                        {unitOptions.map((opt:any) => <option key={opt.id} value={opt.label}>{opt.label}</option>)}
                      </select>
                    ) : (
                      <input type="text" required value={editModal.p_unit} onChange={(e) => setEditModal({...editModal, p_unit: e.target.value})} className="w-full p-2.5 bg-white border border-emerald-200 rounded-lg text-[11px] font-black text-slate-900 outline-none shadow-sm" placeholder="예: BOX" />
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest block mb-1.5">지급(신청) 단위</label>
                    {unitOptions.length > 0 ? (
                      <select required value={editModal.r_unit} onChange={(e) => setEditModal({...editModal, r_unit: e.target.value})} className="w-full p-2.5 bg-white border border-amber-200 rounded-lg text-[11px] font-black text-slate-700 outline-none focus:border-amber-500 shadow-sm">
                        {unitOptions.map((opt:any) => <option key={opt.id} value={opt.label}>{opt.label}</option>)}
                      </select>
                    ) : (
                      <input type="text" required value={editModal.r_unit} onChange={(e) => setEditModal({...editModal, r_unit: e.target.value})} className="w-full p-2.5 bg-white border border-amber-200 rounded-lg text-[11px] font-black text-slate-900 outline-none shadow-sm" placeholder="예: EA" />
                    )}
                  </div>
                </div>
     
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-1.5">현재고 (수동강제조정)</label>
                    <input 
                      type="number" min="0" required value={editModal.current_stock} onChange={(e) => setEditModal({...editModal, current_stock: e.target.value})}
                      className="w-full p-2.5 bg-white border border-blue-200 rounded-xl text-xs font-black text-blue-600 outline-none focus:border-blue-500 shadow-sm text-right"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1.5">위험 경고 알림 수량</label>
                    <input 
                      type="number" min="0" required value={editModal.alert_qty} onChange={(e) => setEditModal({...editModal, alert_qty: e.target.value})}
                      className="w-full p-2.5 bg-white border border-orange-200 rounded-xl text-xs font-black text-orange-600 outline-none focus:border-orange-400 shadow-sm text-right"
                    />
                  </div>
                </div>
     
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">관리 비고 (Note)</label>
                  <input 
                    type="text" value={editModal.note} onChange={(e) => setEditModal({...editModal, note: e.target.value})}
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 outline-none focus:border-indigo-500 shadow-sm"
                    placeholder="특이사항 메모 (선택)"
                  />
                </div>
     
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditModal(null)} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-[11px] font-black text-slate-500 hover:bg-slate-100 transition-colors shadow-sm">
                    취소
                  </button>
                  <button type="submit" className="flex-[2] py-3 bg-slate-900 text-white rounded-xl text-[11px] font-black hover:bg-indigo-600 transition-colors shadow-md">
                    {editModal.isNew ? '신규 데이터 DB 등록' : '변경사항 서버 전송'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
     
      {/* 📦 입고 처리 모달 */}
      {stockInModal && (
        <div className="fixed inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-[550px] border border-slate-200 shadow-2xl p-8 rounded-2xl">
            <h4 className="text-[14px] font-black text-slate-900 uppercase tracking-widest mb-4 border-b-2 border-slate-900 pb-3">
              📦 소모품 실물 창고 입고 처리
            </h4>
            <div className="bg-slate-100 p-3 rounded-lg mb-6 flex justify-between items-center">
              <span className="font-black text-indigo-700 text-xs">{stockInModal.name}</span>
              <span className="font-mono text-[11px] text-slate-500 font-bold">{stockInModal.id}</span>
            </div>
            
            <form onSubmit={handleStockInSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1.5">구입 일자</label>
                  <input 
                    type="date" required value={stockInModal.purchase_date} onChange={e => setStockInModal({...stockInModal, purchase_date: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500 text-slate-600" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1.5">창고 입고 일자</label>
                  <input 
                    type="date" required value={stockInModal.stock_in_date} onChange={e => setStockInModal({...stockInModal, stock_in_date: e.target.value})}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500 text-slate-800" 
                  />
                </div>
              </div>
     
              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1.5">구입처 (벤더/업체명)</label>
                <input 
                  type="text" required value={stockInModal.vendor} onChange={e => setStockInModal({...stockInModal, vendor: e.target.value})}
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
                        type="number" required min="1" value={stockInModal.qty} onChange={e => setStockInModal({...stockInModal, qty: e.target.value})}
                        className="w-full p-2.5 bg-white border-2 border-emerald-400 rounded-lg text-[11px] font-black text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-200 text-right shadow-sm" 
                      />
                      <span className="text-[12px] font-black text-emerald-700 shrink-0 min-w-[24px]">{stockInModal.p_unit}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 block mb-1.5">물품 순수 단가(개당)</label>
                    <input 
                      type="number" required min="0" value={stockInModal.base_price} onChange={e => setStockInModal({...stockInModal, base_price: e.target.value})}
                      className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-emerald-500 text-right" 
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-orange-600 block mb-1.5">부대비용 (배송비, 인쇄비, 세금 등 전체 금액)</label>
                  <input 
                    type="number" required min="0" value={stockInModal.extra_cost} onChange={e => setStockInModal({...stockInModal, extra_cost: e.target.value})}
                    className="w-full p-2.5 bg-white border border-orange-300 rounded-lg text-[11px] font-bold outline-none focus:border-orange-500 text-right" 
                    placeholder="발생하지 않았다면 0" 
                  />
                </div>
              </div>
     
              <div className="pt-2">
                <div className="flex justify-between items-center bg-slate-800 text-white p-4 rounded-xl shadow-inner">
                  <span className="text-[11px] font-black uppercase tracking-widest text-emerald-400">결산 총 입고 비용</span>
                  <span className="text-lg font-black">{formatNum((Number(stockInModal.qty) * Number(stockInModal.base_price)) + Number(stockInModal.extra_cost))} <span className="text-[11px] font-medium ml-0.5">원</span></span>
                </div>
              </div>
     
              <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setStockInModal(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-bold text-[11px] hover:bg-slate-200">취소</button>
                <button type="submit" className="flex-[2] py-3.5 bg-emerald-600 text-white rounded-xl font-black text-[12px] shadow-md hover:bg-emerald-700 flex justify-center items-center gap-2">
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
     
export default function MasterDashboardModule(props: any) {
  return (
    <Suspense fallback={<div className="p-20 text-center font-black animate-pulse text-indigo-400 uppercase tracking-widest text-xl">LOADING SERVER WORKSPACE...</div>}>
      <SuppliesMasterDashboardContent {...props} />
    </Suspense>
  );
}