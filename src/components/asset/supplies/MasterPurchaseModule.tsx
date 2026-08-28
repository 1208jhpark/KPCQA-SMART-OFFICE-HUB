'use client';
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getKSTDateString, getKSTNowYearMonth, getKSTYearMonth } from '@/utils/dateUtils';
import LoadingState from '@/components/common/LoadingState';
import { resolveInterfaceEditState } from '@/lib/permission-utils';
import {
  SUPPLIES_MASTER_TABS,
  useInterfaceStepTabs,
} from '@/lib/interface-step-tabs';

const MENU_PATH = '/asset/supplies/master/purchase';

/** KST 기준 연·월 문자열 (year: '2026', month: '07') */
function getKSTYearMonthParts(dateInput: Date | string | number | null | undefined) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const ym = getKSTYearMonth(dateInput);
  if (!ym) return null;
  return {
    year: String(ym.year),
    month: String(ym.month).padStart(2, '0'),
  };
}
     
function MasterPurchaseContent() {
  const pathname = usePathname();
  const tabs = useInterfaceStepTabs(SUPPLIES_MASTER_TABS, '/asset/supplies/master');
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
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedYear, setSelectedYear] = useState(String(getKSTNowYearMonth().year));
  const [selectedMonth, setSelectedMonth] = useState('ALL');
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
     
  useEffect(() => { 
    fetchData(); 
  }, []);
     
  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [userRes, purchaseRes, summaryRes, pendingRes, ifRes] = await Promise.all([
        fetch(`/api/auth/me?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/asset/supplies/master/purchase?t=${ts}`, { cache: 'no-store' }),
        fetch(`/api/admin/interface/summary?path=${encodeURIComponent(MENU_PATH)}&t=${ts}`, {
          cache: 'no-store',
        }).catch(() => null),
        fetch(`/api/asset/supplies/master/pending-count?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/admin/interface?t=${ts}`, { cache: 'no-store' }).catch(() => null),
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
      if (ifRes && ifRes.ok) {
        const interfaces = await ifRes.json();
        const menu = Array.isArray(interfaces)
          ? interfaces.find((m: any) => m.path === MENU_PATH || m.path?.includes('/supplies/master/purchase'))
          : null;
        setInterfaceConfig(menu || null);
      } else {
        setInterfaceConfig(null);
      }
      if (pendingRes && pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingReqCount(Number(data.pendingCount) || 0);
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
    const years = purchases
      .map((p) => getKSTYearMonthParts(p.purchase_date || p.createdAt)?.year)
      .filter(Boolean) as string[];
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curr = String(getKSTNowYearMonth().year);
    if (!unique.includes(curr)) unique.push(curr);
    return unique;
  }, [purchases]);
  
  const availableMonths = ['01','02','03','04','05','06','07','08','09','10','11','12'];
     
  const baseFilteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      const ym = getKSTYearMonthParts(p.purchase_date || p.createdAt);
      const yearMatch = selectedYear === 'ALL' || ym?.year === selectedYear;
      const monthMatch = selectedMonth === 'ALL' || ym?.month === selectedMonth;
      
      const itemName = p.item?.name || '알 수 없는 품목';
      const searchMatch = !searchQuery || 
        itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.old_vendor || p.vendor || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
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
    if (!canEdit) return alertNoEditPermission();
    const itemName = purchaseData.item?.name || '알 수 없는 품목';
    if (
      !confirm(
        `[경고] 정말 [${itemName}] 입고 내역을 철회하시겠습니까?\n철회 시 해당 물품의 재고가 자동으로 차감됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/asset/supplies/master/purchase?id=${purchaseData.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: purchaseData.id }),
      });

      if (res.ok) {
        alert('✅ 정상적으로 입고가 철회되었습니다.');
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 철회 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
    }
  };

  /** LV_1 전용 — 잘못된 백데이터 정리용 영구 삭제 (입고철회와 동일 API) */
  const handleDeletePurchaseLv1 = async (purchaseData: any) => {
    if (!canEdit) return alertNoEditPermission();
    if (!isLv1) {
      return alert('잘못된 데이터 삭제는 LV_1만 가능합니다.');
    }
    const itemName = purchaseData.item?.name || '알 수 없는 품목';
    if (
      !confirm(
        `경고: [${itemName}] 입고 내역을 영구 삭제하시겠습니까? (LV_1 · 백데이터 정리)\n삭제 시 해당 수량만큼 현재고가 차감됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/asset/supplies/master/purchase?id=${purchaseData.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: purchaseData.id }),
      });

      if (res.ok) {
        alert('🗑️ 입고 내역이 삭제되었습니다.');
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`🚨 삭제 실패: ${err.error || '알 수 없는 오류'}`);
      }
    } catch (e) {
      alert('서버와 통신할 수 없습니다.');
    }
  };
     
  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 ? purchases.filter(p => selectedIds.has(p.id)) : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    
    // 엑셀 다운로드 — 입고 팝업/장부 라벨과 동일
    const exportData = targetList.map((p, idx) => {
      let extraCost = 0;
      let boughtDate = '';
      let pQty = Number(p.qty) || 0;
      let pUnit = '';
      let linkQty = 1;
      let sUnit = '';
      let stockQty = Number(p.qty) || 0;
      
      try {
        if (p.item?.description) {
          const itemExt = JSON.parse(p.item.description);
          sUnit = itemExt.s_unit || itemExt.r_unit || '';
          pUnit = itemExt.p_unit || '';
        }
      } catch(e) {}
      
      try {
        if (p.note) {
          const parsed = JSON.parse(p.note);
          extraCost = Number(parsed.extra_cost) || 0;
          boughtDate = parsed.bought_date || '';
          if (Number(parsed.p_qty) > 0) pQty = Number(parsed.p_qty);
          if (parsed.p_unit) pUnit = parsed.p_unit;
          if (Number(parsed.link_qty) > 0) linkQty = Number(parsed.link_qty);
          if (parsed.s_unit) sUnit = parsed.s_unit;
          if (Number(parsed.stock_qty) > 0) stockQty = Number(parsed.stock_qty);
        }
      } catch(e) {}
     
      return {
        'NO': targetList.length - idx,
        '창고 입고일': p.purchase_date ? getKSTDateString(p.purchase_date) : '-',
        '구입 일자': boughtDate ? getKSTDateString(boughtDate) : '-',
        '물품명': p.item?.name || '(삭제된 품목)',
        '구입처(벤더)': p.old_vendor || '-',
        '입고수량': pQty,
        '입고단위': pUnit || '-',
        '연동수량': linkQty,
        '재고반영(지급단위)': stockQty,
        '지급단위': sUnit || '-',
        '물품 순수 단가(입고단위)': p.unit_price,
        '부대비용(원)': extraCost,
        '결산 총비용(원)': p.total_price,
        '등록자': p.purchaser_name || '관리자',
        '소속부서': p.purchaser_dept || '-',
      };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입고대장");
    XLSX.writeFile(wb, `소모품_입고매입대장_${selectedYear}년${selectedMonth !== 'ALL' ? `_${selectedMonth}월` : ''}.xlsx`);
  };
     
  const isLv1 = useMemo(() => {
    if (!currentUser) return false;
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles : [currentUser.role];
    return roles?.includes('LV_1');
  }, [currentUser]);

  const canEdit = useMemo(
    () => resolveInterfaceEditState(currentUser, interfaceConfig).isEditor,
    [currentUser, interfaceConfig]
  );

  const alertNoEditPermission = () => alert('편집 권한이 없습니다.');
  const disabledActionBtn =
    'px-1.5 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md text-[10px] font-black cursor-not-allowed whitespace-nowrap opacity-70';

  if (loading) return <LoadingState />;
     
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
        {!canEdit && (
          <span className="text-[10px] font-black text-amber-200 bg-amber-500/20 border border-amber-300/30 px-2.5 py-1 rounded-md">
            편집 권한 없음 — 조회만 가능
          </span>
        )}
      </div>
    )}
  </div>
</div>
     
      {/* 탭 네비게이션 — client-search / distribution 스위처 규격 */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            const showPendingBadge = tab.id === 'requests' && pendingReqCount > 0;
            return (
              <Link
                key={tab.id}
                href={tab.path}
                className={`px-5 py-2 rounded-md text-xs font-black transition-all flex items-center gap-2 ${
                  isActive
                    ? `bg-white ${tab.activeColor || 'text-indigo-600'} shadow-sm border border-slate-200/80`
                    : 'text-slate-500 hover:text-slate-800'
                } ${showPendingBadge && !isActive ? 'ring-1 ring-red-300/80' : ''}`}
              >
                <span>{tab.label}</span>
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
        
        <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></div>
            <h2 className="text-sm font-black text-slate-800 tracking-tight">입고(매입) 내역 장부</h2>
            <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{finalFilteredPurchases.length}건</span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase">연도</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                <option value="ALL">전체</option>
                {availableYears.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <div className="w-px h-3.5 bg-slate-300 mx-0.5"></div>
              <span className="text-[10px] font-black text-slate-400 uppercase">월별</span>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="text-[11px] font-black text-slate-800 outline-none cursor-pointer bg-transparent">
                <option value="ALL">전체</option>
                {availableMonths.map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>
            <div className="relative w-48">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">🔍</span>
              <input type="text" placeholder="물품, 구입처, 등록자 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-7 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold outline-none focus:border-indigo-500 shadow-sm transition-colors" />
            </div>
            <button onClick={handleDownloadExcel} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black shadow-sm hover:bg-emerald-700 transition-all whitespace-nowrap">
              {selectedIds.size > 0 ? `선택 EXCEL 다운로드(${selectedIds.size})` : '화면 목록 EXCEL 다운로드'}
            </button>
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
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed min-w-[1360px]">
            <colgroup>
              <col className="w-[40px]" />
              <col className="w-[48px]" />
              <col className="w-[88px]" />
              <col className="w-[88px]" />
              <col className="w-[140px]" />
              <col className="w-[100px]" />
              <col className="w-[72px]" />
              <col className="w-[72px]" />
              <col className="w-[72px]" />
              <col className="w-[88px]" />
              <col className="w-[100px]" />
              <col className="w-[88px]" />
              <col className="w-[100px]" />
              <col className="w-[110px]" />
              <col className="w-[168px]" />
            </colgroup>
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 text-center">
                  <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedIds.has(p.id))} onChange={() => {
                    const currentIds = paginatedPurchases.map(p => p.id);
                    const allSelected = currentIds.every(id => selectedIds.has(id));
                    const next = new Set(selectedIds);
                    if (allSelected) currentIds.forEach(id => next.delete(id)); else currentIds.forEach(id => next.add(id));
                    setSelectedIds(next);
                  }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                </th>
                <th className="h-12 px-2 text-center">NO</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">창고 입고 일자</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">구입 일자</th>
                <th className="h-12 px-2 text-indigo-600">물품명</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">구입처(벤더)</th>
                <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">입고수량</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">입고단위</th>
                <th className="h-12 px-2 text-center whitespace-nowrap">연동수량</th>
                <th className="h-12 px-2 text-center text-indigo-600 whitespace-nowrap">재고반영</th>
                <th className="h-12 px-2 text-right whitespace-nowrap">물품 순수 단가</th>
                <th className="h-12 px-2 text-right whitespace-nowrap">부대비용</th>
                <th className="h-12 px-2 text-right text-emerald-700 whitespace-nowrap">결산 총비용</th>
                <th className="h-12 px-2 text-center border-l border-slate-200 whitespace-nowrap">부서 / 등록자</th>
                <th className="h-12 px-2 text-center whitespace-nowrap border-l border-slate-200">관리 액션</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-[11px] font-bold text-slate-700">
              {paginatedPurchases.length === 0 ? (
                <tr><td colSpan={15} className="p-16 text-center text-slate-400 text-xs">조건에 맞는 입고 내역이 없습니다.</td></tr>
              ) : paginatedPurchases.map((p, i) => {
                const isSelected = selectedIds.has(p.id);
                const itemName = p.item?.name || '(삭제된 품목)';
                
                let pQty = Number(p.qty) || 0;
                let pUnit = '-';
                let linkQty = 1;
                let sUnit = '';
                let stockQty = Number(p.qty) || 0;
                let extraCost = 0;
                let boughtDate = '';

                try {
                  if (p.item?.description) {
                    const itemExt = JSON.parse(p.item.description);
                    sUnit = itemExt.s_unit || itemExt.r_unit || '';
                    if (itemExt.p_unit) pUnit = itemExt.p_unit;
                  }
                } catch(e) {}
                
                try {
                  if (p.note) {
                    const parsedNote = JSON.parse(p.note);
                    extraCost = Number(parsedNote.extra_cost) || 0;
                    boughtDate = parsedNote.bought_date || '';
                    if (Number(parsedNote.p_qty) > 0) pQty = Number(parsedNote.p_qty);
                    if (parsedNote.p_unit) pUnit = parsedNote.p_unit;
                    if (Number(parsedNote.link_qty) > 0) linkQty = Number(parsedNote.link_qty);
                    if (parsedNote.s_unit) sUnit = parsedNote.s_unit;
                    if (Number(parsedNote.stock_qty) > 0) stockQty = Number(parsedNote.stock_qty);
                  }
                } catch(e) {}

                const rowNo = finalFilteredPurchases.length - ((currentPage - 1) * itemsPerPage) - i;
     
                return (
                  <tr key={p.id} className={`hover:bg-slate-50/50 h-12 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                    <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                    </td>
                    <td className="px-2 text-center font-mono text-slate-500 tabular-nums">{rowNo}</td>
                    <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-800">
                      {p.purchase_date ? getKSTDateString(p.purchase_date) : '-'}
                    </td>
                    <td className="px-2 text-center whitespace-nowrap tabular-nums text-slate-700">
                      {boughtDate ? getKSTDateString(boughtDate) : '-'}
                    </td>
                    <td className="px-2 text-indigo-700 truncate" title={itemName}>{itemName}</td>
                    <td className="px-2 text-center text-slate-700 truncate" title={p.old_vendor}>{p.old_vendor || '-'}</td>
                    <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600">{pQty}</td>
                    <td className="px-2 text-center text-slate-500">{pUnit}</td>
                    <td className="px-2 text-center font-mono tabular-nums text-slate-600">{linkQty}</td>
                    <td className="px-2 text-center font-mono whitespace-nowrap tabular-nums text-indigo-600" title={`지급단위: ${sUnit || '-'}`}>
                      {stockQty}
                      {sUnit && <span className="text-[9px] text-indigo-500 font-bold ml-0.5">{sUnit}</span>}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-700">{Number(p.unit_price || 0).toLocaleString()}</td>
                    <td className="px-2 text-right font-mono tabular-nums text-slate-700">{extraCost.toLocaleString()}</td>
                    <td className="px-2 text-right font-mono tabular-nums text-emerald-600">{Number(p.total_price || 0).toLocaleString()}</td>
                    <td className="px-2 text-center border-l border-slate-200">
                      <div className="truncate">
                        <span className="text-[10px] text-slate-500 block truncate">{p.purchaser_dept || '-'}</span>
                        <span className="text-slate-800 truncate">{p.purchaser_name || '관리자'}</span>
                      </div>
                    </td>
                    <td className="px-1.5 text-center border-l border-slate-200">
                      <div className="inline-flex items-center justify-center gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleCancelPurchase(p)}
                          title={canEdit ? '입고 철회 (재고 차감)' : '편집 권한 필요'}
                          className={
                            canEdit
                              ? 'px-1.5 py-1.5 bg-orange-50 text-orange-600 border border-orange-200 rounded-md text-[10px] font-black hover:bg-orange-100 shadow-sm whitespace-nowrap'
                              : disabledActionBtn
                          }
                        >
                          입고철회
                        </button>
                        {canEdit ? (
                          isLv1 ? (
                            <button
                              type="button"
                              onClick={() => handleDeletePurchaseLv1(p)}
                              title="잘못된 백데이터 영구 삭제 — LV_1 전용"
                              className="px-1.5 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-md text-[10px] font-black hover:text-red-500 hover:bg-red-50 whitespace-nowrap"
                            >
                              삭제(LV_1)
                            </button>
                          ) : null
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDeletePurchaseLv1(p)}
                            title="편집 권한 필요"
                            className={disabledActionBtn}
                          >
                            삭제(LV_1)
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
     
        {finalFilteredPurchases.length > 0 && (
          <div className="flex justify-center items-center gap-1.5 py-3 border-t border-slate-100 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors">다음</button>
          </div>
        )}
      </section>
    </div>
  );
}
     
export default function MasterPurchaseModule() {
  return <Suspense fallback={<LoadingState />}><MasterPurchaseContent /></Suspense>;
}