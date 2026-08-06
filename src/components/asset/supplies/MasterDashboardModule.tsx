// src/components/asset/supplies/MasterDashboardModule.tsx
'use client';
     
import React, { useState, useEffect, useMemo, Suspense, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
import { isPendingSupplyRequest } from '@/utils/supplyRequestStatus';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';

const MENU_PATH = '/asset/supplies/master/dashboard';
     
function SuppliesMasterDashboardContent({ currentUser: propUser }: { currentUser?: any }) {
  const pathname = usePathname();
  
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(propUser || null);
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  const [config, setConfig] = useState<any>(null);
  const [masterData, setMasterData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
     
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
      const [dashRes, reqRes, confRes, mastRes, userRes, summaryRes, ifRes] = await Promise.all([
        fetch(`/api/asset/supplies/master/dashboard?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/config?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/master-data?t=${ts}`, { cache: 'no-store' }),
        !propUser ? fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }) : Promise.resolve(null),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
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

      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);

      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/supplies/master/dashboard'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
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
      id: '', 
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
    if (!editModal.isNew && !editModal.id.trim()) return alert('품목 정보가 올바르지 않습니다.');
     
    const payload = {
      ...(editModal.isNew ? {} : { id: editModal.id.trim() }),
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
     
  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  /** 삭제: Edit 권한 + 신청·입고 이력 0건일 때만 (잘못 등록한 데이터 정리용) */
  const handleDeleteItem = async (item: any) => {
    if (!canEdit) return alert('삭제 권한이 없습니다.');

    const usageCount = Number(item?._count?.requests || 0) + Number(item?._count?.purchases || 0);
    if (usageCount > 0) {
      return alert('신청·입고 이력이 있어 삭제할 수 없습니다. 보관 처리만 가능합니다.');
    }

    if (!confirm('정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 마스터에서 완전히 영구 삭제됩니다.')) return;

    try {
      const res = await fetch(`/api/asset/supplies/master/dashboard?id=${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('완전히 삭제되었습니다.');
        fetchDashboardData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`삭제 불가: ${err.error || '권한을 확인하세요.'}`);
      }
    } catch (e) {
      alert('삭제 통신 실패');
    }
  };
     
  if (loading) return <LoadingState />;
     
  return (
    <div className="w-full max-w-[1750px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
{/* client-search 배너 규격: emerald→teal · orbs · label 10px / title 2xl / desc xs */}
<div className="w-full bg-gradient-to-r from-emerald-900 to-teal-900 rounded-3xl text-white shadow-lg relative overflow-hidden px-6 md:px-8 py-6">
  <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-400/15 rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
  <div className="absolute left-1/4 bottom-0 w-48 h-48 bg-teal-800/20 rounded-full blur-3xl translate-y-1/2 pointer-events-none" />
  <div className="relative z-10">
    <h3 className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2.5">
      CENTRAL SUPPLIES CONTROL TOWER
    </h3>
    <h1 className="text-2xl font-extrabold tracking-tight text-white leading-none">
      소모품 마스터 관리 통제실
    </h1>
    <p className="text-emerald-100/90 text-xs mt-3 leading-relaxed">
      전사 소모품의 전체 관리 및 실시간 재고 현황을 모니터링하고 관리합니다.
    </p>
    {permissionSummary && (
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-white/15">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-tight bg-white/10 border-white/25 text-emerald-50 shadow-sm">
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
      </div>
    )}
  </div>
</div>
      
      {/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabItems.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            const activeColor =
              tab.id === 'purchase' ? 'text-emerald-600' :
              tab.id === 'archive' ? 'text-slate-800' :
              'text-indigo-600';
            const showPendingBadge = tab.id === 'requests' && stats.pendingReqs > 0;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${activeColor} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                } ${showPendingBadge && !isActive ? 'ring-1 ring-red-300/80' : ''}`}
              >
                <span>{tab.name}</span>
                {showPendingBadge && (
                  <span className="inline-flex items-center justify-center min-w-[1.35rem] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-black font-mono shadow-sm animate-pulse">
                    {stats.pendingReqs}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 font-bold px-3 hidden lg:block">
          ※ 탭을 클릭하여 대시보드·신청·입고·아카이브를 전환합니다.
        </p>
      </div>
     
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="p-3 px-5 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
            <h2 className="text-[13px] font-black text-slate-800 tracking-tight">
              {statFilter === 'ALL' ? '실시간 창고 재고 현황 보드' : 
               statFilter === 'PENDING' ? '신청 대기중인 물품 리스트' : 
               statFilter === 'WARNING' ? '재고 경고(부족) 물품 리스트' : '품절된 물품 리스트'}
            </h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{filteredItems.length}개 품목</span>
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={() => setStatFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                  statFilter === 'ALL'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                전체 {stats.totalItems}
              </button>
              <button
                type="button"
                onClick={() => setStatFilter((prev) => (prev === 'WARNING' ? 'ALL' : 'WARNING'))}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                  statFilter === 'WARNING'
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100'
                }`}
              >
                재고 경고 {stats.warningCount}
              </button>
              <button
                type="button"
                onClick={() => setStatFilter((prev) => (prev === 'OUT' ? 'ALL' : 'OUT'))}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-colors ${
                  statFilter === 'OUT'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-50 text-red-600 border border-red-100 hover:bg-red-100'
                }`}
              >
                품절 {stats.outOfStockCount}
              </button>
            </div>
          </div>
          <button onClick={handleAddNewClick} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700 transition-all shadow-sm flex items-center gap-1.5 shrink-0">
            + 신규 물품 추가
          </button>
        </div>
     
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed">
            <colgroup>
              <col className="w-12" />
              <col className="w-[296px]" />
              <col className="w-[70px]" />
              <col className="w-[96px]" />
              <col className="w-[92px]" />
              <col className="w-[280px]" />
              <col className="w-[88px]" />
              <col className="w-[108px]" />
              <col className="w-[200px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-3 text-center">NO</th>
                <th className="h-12 px-3 text-left">품목명</th>
                <th className="h-12 px-2 text-center whitespace-nowrap text-blue-700 border-l border-slate-300 bg-blue-50/60">현재고</th>
                <th className="h-12 px-2 text-center whitespace-nowrap bg-blue-50/60">재고알람기준</th>
                <th className="h-12 px-2 text-center whitespace-nowrap bg-blue-50/60">재고 상태</th>
                <th className="h-12 px-2 text-left bg-blue-50/60">관리 비고</th>
                <th className="h-12 px-2 text-center whitespace-nowrap text-amber-700 border-l border-slate-300 bg-amber-50/60">신청단위</th>
                <th className="h-12 px-2 text-center whitespace-nowrap text-amber-700 bg-amber-50/60">게시 제어</th>
                <th className="h-12 pr-3 text-center whitespace-nowrap border-l border-slate-300">마스터 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-16 text-center text-slate-400 text-xs">
                    조건에 맞는 데이터가 없습니다.
                  </td>
                </tr>
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
                  const usageCount =
                    Number(item?._count?.requests || 0) + Number(item?._count?.purchases || 0);
                  const hasUsageHistory = usageCount > 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors h-12 ${
                        isOut
                          ? 'bg-red-50/30 hover:bg-red-50'
                          : isDanger
                            ? 'bg-orange-50/30 hover:bg-orange-50'
                            : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="pl-3 text-center font-mono text-slate-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-3 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 bg-slate-100 flex justify-center items-center">
                            {item.image_url ? (
                              <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] opacity-40">📦</span>
                            )}
                          </div>
                          <span className="text-slate-900 truncate" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`px-2 text-center font-mono whitespace-nowrap tabular-nums border-l border-slate-200 bg-blue-50/20 ${
                          isOut ? 'text-red-500' : isDanger ? 'text-orange-500' : 'text-blue-600'
                        }`}
                      >
                        {formatNum(currentStock)}
                      </td>
                      <td className="px-2 text-center font-mono text-slate-500 tabular-nums whitespace-nowrap bg-blue-50/20">
                        {safeStock}
                      </td>
                      <td className="px-2 text-center bg-blue-50/20">
                        <span
                          className={`inline-block border px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                            isOut
                              ? 'bg-red-50 text-red-600 border-red-200'
                              : isDanger
                                ? 'bg-orange-50 text-orange-600 border-orange-200'
                                : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          }`}
                        >
                          {isOut ? '품절' : isDanger ? '재고부족' : '정상운용'}
                        </span>
                      </td>
                      <td className="px-2 truncate text-slate-700 bg-blue-50/20" title={note}>
                        {note}
                      </td>
                      <td className="px-2 text-center text-amber-600 whitespace-nowrap border-l border-slate-200 bg-amber-50/20">
                        {rUnit}
                      </td>
                      <td className="px-2 text-center bg-amber-50/20">
                        <button
                          type="button"
                          onClick={() => handleTogglePublish(item.id, isPublished)}
                          className={`w-full py-1 rounded-md text-[10px] font-black shadow-sm transition-all border ${
                            isPublished
                              ? 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                              : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          {isPublished ? '게시내리기' : '게시올리기'}
                        </button>
                      </td>
                      <td className="pr-3 px-2 border-l border-slate-200">
                        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              setStockInModal({
                                id: item.id,
                                name: item.name,
                                vendor: lastPurchase.old_vendor || '',
                                base_price: item.unit_price || 0,
                                extra_cost: 0,
                                qty: '',
                                p_unit: pUnit,
                                purchase_date: getKSTDateString(),
                                stock_in_date: getKSTDateString(),
                              })
                            }
                            className="px-2 py-1 rounded text-[10px] font-black bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition-colors"
                          >
                            입고
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditClick(item)}
                            className="px-2 py-1 rounded text-[10px] font-black bg-white text-blue-600 border border-blue-200 shadow-sm hover:bg-blue-50 transition-colors"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchive(item.id)}
                            className="px-2 py-1 rounded text-[10px] font-black bg-white text-slate-500 border border-slate-200 shadow-sm hover:bg-slate-100 transition-colors"
                          >
                            보관함
                          </button>
                          {canEdit && !hasUsageHistory && (
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item)}
                              className="px-2 py-1 rounded text-[10px] font-black bg-red-50 border border-red-200 text-red-500 shadow-sm hover:bg-red-500 hover:text-white transition-colors"
                              title="신청·입고 이력이 없는 품목만 삭제 가능"
                            >
                              삭제
                            </button>
                          )}
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
                    <label className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1.5">재고 알람 기준 수량</label>
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
    <Suspense fallback={<LoadingState />}>
      <SuppliesMasterDashboardContent {...props} />
    </Suspense>
  );
}