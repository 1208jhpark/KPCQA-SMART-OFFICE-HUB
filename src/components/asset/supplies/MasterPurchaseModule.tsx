'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { isPendingSupplyRequest } from '@/utils/supplyRequestStatus';

const MENU_PATH = '/asset/supplies/master/purchase';
     
function MasterPurchaseContent() {
  const pathname = usePathname();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingReqCount, setPendingReqCount] = useState(0);
  const [permissionSummary, setPermissionSummary] = useState<{
    masterName: string;
    accessDesignate: string;
    accessOrg: string;
    accessLevel: string;
    editDesignate: string;
    editLevel: string;
  } | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  const tabItems = [
    { id: 'dashboard', name: '🗂️ 소모품 마스터 대시보드', path: '/asset/supplies/master/dashboard' },
    { id: 'requests', name: '📋 사용자 신청현황 관리', path: '/asset/supplies/master/requests' },
    { id: 'purchase', name: '💰 입고/구매 내역 대장', path: '/asset/supplies/master/purchase' },
    { id: 'archive', name: '📁 폐기자산 아카이브', path: '/asset/supplies/master/archive' },
  ];
     
  useEffect(() => { 
    fetchData(); 
  }, []);
     
  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, purchaseRes, summaryRes, reqRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/purchase?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/asset/supplies/master/requests?t=${ts}`, { cache: 'no-store' }).catch(() => null),
      ]);
      
      if (userRes.ok) setCurrentUser(await userRes.json());
      if (purchaseRes.ok) {
        setPurchases(await purchaseRes.json());
      } else if (purchaseRes.status === 401 || purchaseRes.status === 403) {
        const err = await purchaseRes.json().catch(() => ({}));
        alert(err.error || '입고 대장 권한이 없습니다.');
      } else {
        const err = await purchaseRes.json().catch(() => ({}));
        alert(err.error || '입고 내역을 불러오지 못했습니다.');
      }
      if (summaryRes && summaryRes.ok) setPermissionSummary(await summaryRes.json());
      else setPermissionSummary(null);
      if (reqRes && reqRes.ok) {
        const reqs = await reqRes.json();
        setPendingReqCount(Array.isArray(reqs) ? reqs.filter((r: any) => isPendingSupplyRequest(r.status)).length : 0);
      } else {
        setPendingReqCount(0);
      }
    } catch (e) {
      console.error("Purchase Sync Error", e);
      alert('서버와 통신할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };
     
  const availableYears = useMemo(() => {
    const years = purchases.map(p => new Date(p.purchase_date || p.createdAt).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = new Date().getFullYear().toString();
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [purchases]);
  
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
     
  const baseFilteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const pDate = new Date(p.purchase_date || p.createdAt);
      const yearMatch = selectedYear === 'ALL' || pDate.getFullYear().toString() === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || (pDate.getMonth() + 1).toString().padStart(2, '0') === selectedMonth;
      
      const itemName = p.item?.name || '알 수 없는 품목';
      const searchMatch = !searchQuery || 
        itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.old_vendor || p.vendor || '').toLowerCase().includes(searchQuery.toLowerCase()) || // 🚀 old_vendor 검색 추가
        (p.purchaser_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      return yearMatch && monthMatch && searchMatch;
    }).sort((a, b) => new Date(b.purchase_date || b.createdAt).getTime() - new Date(a.purchase_date || a.createdAt).getTime());
  }, [purchases, selectedYear, selectedMonth, searchQuery]);
     
  const totalBaseAmount = useMemo(() => baseFilteredPurchases.reduce((acc, cur) => acc + (Number(cur.total_price) || 0), 0), [baseFilteredPurchases]);
  
  const itemStats = useMemo(() => {
    const statsMap: Record<string, number> = {};
    baseFilteredPurchases.forEach(p => {
      const name = p.item?.name || '(삭제된 품목)';
      statsMap[name] = (statsMap[name] || 0) + (Number(p.total_price) || 0);
    });
    return Object.entries(statsMap)
      .map(([name, price]) => ({ name, price, percent: totalBaseAmount > 0 ? ((price / totalBaseAmount) * 100).toFixed(1) : '0.0' }))
      .sort((a, b) => b.price - a.price);
  }, [baseFilteredPurchases, totalBaseAmount]);
     
  const finalFilteredPurchases = useMemo(() => {
    if (!selectedItemFilter) return baseFilteredPurchases;
    return baseFilteredPurchases.filter(p => (p.item?.name || '(삭제된 품목)') === selectedItemFilter);
  }, [baseFilteredPurchases, selectedItemFilter]);
     
  const finalTotalAmount = useMemo(() => finalFilteredPurchases.reduce((acc, cur) => acc + (Number(cur.total_price) || 0), 0), [finalFilteredPurchases]);
     
  const totalPages = Math.max(1, Math.ceil(finalFilteredPurchases.length / itemsPerPage));
  const paginatedPurchases = finalFilteredPurchases.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
     
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [selectedYear, selectedMonth, searchQuery, selectedItemFilter]);
     
  const handleCancelPurchase = async (purchaseData: any) => {
    const itemName = purchaseData.item?.name || '알 수 없는 품목';
    if (!confirm(`[경고] 정말 [${itemName}] 입고 내역을 철회하시겠습니까?\n철회 시 해당 물품의 재고가 자동으로 차감됩니다.`)) return;
     
    try {
      const res = await fetch(`/api/asset/supplies/master/purchase?id=${purchaseData.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: purchaseData.id }) 
      });
      
      if (res.ok) {
        alert(`✅ 정상적으로 입고가 철회(삭제)되었습니다.`);
        fetchData(); 
      } else {
        const err = await res.json();
        alert(`🚨 삭제 실패: ${err.error}`);
      }
    } catch (e) {
      alert("서버와 통신할 수 없습니다.");
    }
  };
     
  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 ? purchases.filter(p => selectedIds.has(p.id)) : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    
    // 🚀 엑셀 다운로드 항목도 대시보드 포맷과 동일하게 변경
    const exportData = targetList.map((p, idx) => {
      let pUnit = 'BOX';
      let extraCost = 0;
      
      try {
        if (p.item?.description) {
          const itemExt = JSON.parse(p.item.description);
          pUnit = itemExt.p_unit || 'BOX';
        }
      } catch(e) {}
      
      try {
        if (p.note) {
          const parsed = JSON.parse(p.note);
          extraCost = Number(parsed.extra_cost) || 0;
        }
      } catch(e) {}
     
      return {
        'NO': targetList.length - idx,
        '최근 입고일': p.purchase_date ? getKSTDateString(p.purchase_date) : '-',
        '물품명': p.item?.name || '(삭제된 품목)',
        '구매처(벤더)': p.old_vendor || '-',
        '구매단위': pUnit,
        '입고수량': p.qty,
        '순수 단가(원)': p.unit_price,
        '부대비용(원)': extraCost,
        '결산 총비용(원)': p.total_price,
        '등록자': p.purchaser_name || '관리자',
        '소속부서': p.purchaser_dept || '경영기획센터'
      };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입고대장");
    XLSX.writeFile(wb, `소모품_입고매입대장_${selectedYear}년${selectedMonth !== 'ALL' ? `_${selectedMonth}월` : ''}.xlsx`);
  };
     
  if (loading) return <LoadingState />;
     
  const isLv1 = currentUser?.roles?.includes('LV_1') || currentUser?.role === 'LV_1';
     
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
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
      신규 소모품 내역의 입고 내역을 관리합니다.
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
            const showPendingBadge = tab.id === 'requests' && pendingReqCount > 0;
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
                    {pendingReqCount}
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
  
      <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mt-6">
        
        <div className="p-5 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
            <h2 className="text-[13px] font-black text-slate-800 tracking-tight">입고(매입) 내역 장부</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{finalFilteredPurchases.length}건 검색됨</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-slate-300 shadow-sm text-[11px] font-bold text-slate-600">
              <span>🗓️ 연도:</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black text-indigo-700">
                <option value="ALL">전체 연도</option>
                {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-slate-300 shadow-sm text-[11px] font-bold text-slate-600">
              <span>📅 월별:</span>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black text-indigo-700">
                <option value="ALL">전체 달</option>
                {availableMonths.map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>
            <button onClick={handleDownloadExcel} className="text-[10px] font-black bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-1.5 hover:bg-emerald-100 transition-colors shadow-sm">
              {selectedIds.size > 0 ? `선택 항목 엑셀 다운로드 (${selectedIds.size})` : '화면 목록 엑셀 다운로드 ⬇️'}
            </button>
            <div className="relative w-48">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품, 구입처, 부서 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-inner" />
            </div>
          </div>
        </div>
     
        <div className="p-6 bg-slate-50 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center min-h-[110px]">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">조회 기간 총 입고(매입)액</span>
            <div className="text-2xl font-mono font-black text-emerald-600 mt-1">
              {finalTotalAmount.toLocaleString()} <span className="text-xs text-slate-500 font-sans font-bold">원</span>
            </div>
          </div>
          <div className="lg:col-span-9 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block flex justify-between items-center">
              <span>📦 품목별 입고 비용 지출 요약 (클릭하여 해당 물품만 필터링)</span>
              {selectedItemFilter && (
                <button onClick={() => setSelectedItemFilter(null)} className="text-indigo-500 hover:underline">필터 초기화 ✕</button>
              )}
            </span>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-h-[70px] items-center">
              {itemStats.length === 0 ? (
                <span className="text-xs text-slate-400 font-bold py-2">입고 매입 통계 데이터가 존재하지 않습니다.</span>
              ) : itemStats.map(stat => {
                const isSelected = selectedItemFilter === stat.name;
                return (
                  <div key={stat.name} onClick={() => setSelectedItemFilter(prev => prev === stat.name ? null : stat.name)} className={`shrink-0 border rounded-xl px-4 py-2 flex flex-col justify-center min-w-[140px] cursor-pointer transition-all ${isSelected ? 'bg-indigo-100 border-indigo-300 shadow-md scale-105' : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm'}`}>
                    <span className={`text-[11px] font-black truncate text-left ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{stat.name}</span>
                    <span className="text-[12px] font-mono font-black text-emerald-600 mt-0.5">
                      {stat.price.toLocaleString()}원 <strong className={`text-[10px] ml-1 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>({stat.percent}%)</strong>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto pb-4">
          <table className="w-full text-left text-[11px] border-collapse min-w-[1300px]">
            <thead className="bg-slate-100 text-slate-600 font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 w-10 text-center">
                  <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedIds.has(p.id))} onChange={() => {
                    const currentIds = paginatedPurchases.map(p => p.id);
                    const allSelected = currentIds.every(id => selectedIds.has(id));
                    const next = new Set(selectedIds);
                    if (allSelected) currentIds.forEach(id => next.delete(id)); else currentIds.forEach(id => next.add(id));
                    setSelectedIds(next);
                  }} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                </th>
                <th className="h-12 px-4 w-14 text-center">NO</th>
                
                <th className="h-12 px-4 w-32 text-center border-l-4 border-white bg-emerald-50/50 text-slate-600">최근 입고일</th>
                <th className="h-12 px-4 w-48 bg-emerald-50/50 text-indigo-700">물품명</th>
                
                {/* 🚀 렌더링 헤더를 대시보드와 정확하게 동일한 명칭과 순서로 교체 */}
                <th className="h-12 px-4 w-32 text-center bg-emerald-50/50 text-slate-600">구매처(벤더)</th>
                <th className="h-12 px-4 w-20 text-center bg-emerald-50/50 text-emerald-700">구매단위</th>
                <th className="h-12 px-4 w-24 text-center bg-emerald-50/50 text-emerald-700">입고수량</th>
                <th className="h-12 px-4 w-28 text-right bg-emerald-50/50 text-emerald-700">순수 단가(원)</th>
                <th className="h-12 px-4 w-28 text-right bg-emerald-50/50 text-orange-600">부대비용(원)</th>
                <th className="h-12 px-4 w-32 text-right bg-emerald-50/50 text-emerald-800 font-black">결산 총비용</th>
     
                <th className="h-12 px-4 w-24 text-center border-l-4 border-white">등록자</th>
                <th className="h-12 px-4 w-32 text-center">소속부서</th>
                <th className="h-12 px-4 text-center w-28 border-l-4 border-white">관리</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 font-bold">
              {paginatedPurchases.length === 0 ? (
                <tr><td colSpan={13} className="h-32 text-center text-slate-400 italic">조건에 맞는 입고 내역이 없습니다.</td></tr>
              ) : paginatedPurchases.map((p, i) => {
                const isSelected = selectedIds.has(p.id);
                const itemName = p.item?.name || '(삭제된 품목)';
                
                // 🚀 구매 단위 파싱 (item.description)
                let pUnit = 'BOX';
                try {
                  if (p.item?.description) {
                    const itemExt = JSON.parse(p.item.description);
                    pUnit = itemExt.p_unit || 'BOX';
                  }
                } catch(e) {}
                
                // 🚀 부대비용 파싱 (p.note)
                let extraCost = 0;
                try {
                  if (p.note) {
                    const parsedNote = JSON.parse(p.note);
                    extraCost = Number(parsedNote.extra_cost) || 0;
                  }
                } catch(e) {}
     
                return (
                  <tr key={p.id} className={`h-16 transition-colors ${isSelected ? 'bg-emerald-50/30' : 'hover:bg-slate-50'}`}>
                    <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedIds(next); }} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                    </td>
                    <td className="px-4 text-center text-slate-400 font-mono">
                      {finalFilteredPurchases.length - ((currentPage - 1) * itemsPerPage) - i}
                    </td>
                    
                    <td className="px-4 text-center font-mono text-slate-500 bg-emerald-50/10 border-l-4 border-slate-50">
                      {p.purchase_date ? getKSTDateString(p.purchase_date) : '-'}
                    </td>
                    <td className="px-4 text-indigo-700 text-[12px] bg-emerald-50/10 truncate max-w-[200px]">{itemName}</td>
                    
                    {/* 🚀 데이터를 대시보드 구조에 맞게 순서대로 재배치 */}
                    <td className="px-4 text-center text-slate-600 bg-emerald-50/10 truncate max-w-[120px]" title={p.old_vendor}>{p.old_vendor || '-'}</td>
                    <td className="px-4 text-center text-slate-500 bg-emerald-50/10">{pUnit}</td>
                    <td className="px-4 text-center font-black font-mono text-emerald-600 bg-emerald-50/10">{p.qty}</td>
                    <td className="px-4 text-right font-mono text-slate-600 bg-emerald-50/10">{Number(p.unit_price || 0).toLocaleString()}</td>
                    <td className="px-4 text-right font-mono text-orange-600 bg-emerald-50/10">{extraCost.toLocaleString()}</td>
                    <td className="px-4 text-right font-black font-mono text-emerald-700 bg-emerald-50/10">{Number(p.total_price || 0).toLocaleString()}</td>
     
                    <td className="px-4 text-center border-l-4 border-slate-50 text-slate-700">{p.purchaser_name || '관리자'}</td>
                    <td className="px-4 text-center text-[10px] text-slate-400">{p.purchaser_dept || '경영기획센터'}</td>
                    
                    <td className="px-4 text-center border-l-4 border-slate-50">
                      <button 
                        onClick={() => handleCancelPurchase(p)} 
                        title="입고 장부에서 내역을 삭제합니다. (재고 자동 복구)"
                        className="w-full py-2 rounded-lg text-[10px] font-black transition-colors shadow-sm bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white"
                      >
                        입고 철회
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
     
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-emerald-600 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
          </div>
        )}
      </section>
    </div>
  );
}
     
export default function MasterPurchaseModule() {
  return <Suspense fallback={<LoadingState />}><MasterPurchaseContent /></Suspense>;
}