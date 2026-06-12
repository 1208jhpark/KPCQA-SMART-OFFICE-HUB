'use client';
  
import React, { useState, useEffect, useMemo, Suspense } from 'react';
import * as XLSX from 'xlsx';

// [UI 표준] 공통 HeaderLight 컴포넌트
const HeaderLight = ({ title, count, children }: { title: string, count: number, children?: React.ReactNode }) => (
  <div className="p-4 px-6 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-600"></div>
      <h2 className="text-sm font-black text-slate-800 tracking-tight">{title}</h2>
      <span className="text-[11px] font-bold bg-slate-300/80 text-slate-700 px-2 py-0.5 rounded-md">{count}건</span>
    </div>
    {children}
  </div>
);
  
function DeptDistributionContent() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]); 
  const [items, setItems] = useState<any[]>([]); 
  const [interfaceConfig, setInterfaceConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedClientFilter, setSelectedClientFilter] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [isPurchaseOpen, setIsPurchaseOpen] = useState<boolean>(false);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseYear, setPurchaseYear] = useState(new Date().getFullYear().toString());
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<Set<string>>(new Set());
  const [currentPurchasePage, setCurrentPurchasePage] = useState(1);
  const [selectedItemFilter, setSelectedItemFilter] = useState<string | null>(null);

  const itemsPerPage = 10; 
  
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const ts = Date.now();
      const [uRes, iRes, purRes, itemRes] = await Promise.all([
        fetch('/api/auth/me?t=' + ts),
        fetch('/api/admin/interface?t=' + ts),
        fetch('/api/marketing/purchases?t=' + ts), 
        fetch('/api/marketing/items?t=' + ts)       
      ]);

      if (purRes.ok) setPurchases(await purRes.json());
      if (itemRes.ok) setItems(await itemRes.json());

      if (uRes.ok) {
        const user = await uRes.json();
        setCurrentUser(user);
        
        if (user?.unit?.unit_name) {
          const dRes = await fetch(`/api/marketing/distributions?dept=${encodeURIComponent(user.unit.unit_name)}&t=${ts}`);
          if (dRes.ok) setDistributions(await dRes.json());
        }
      }

      if (iRes.ok) {
        const interfaces = await iRes.json();
        const config = interfaces.find((m: any) => m.path === '/marketing/distribution/dept');
        setInterfaceConfig(config);
      }
    } catch(e) {
      console.error("데이터 통합 로드 실패:", e);
    }
    setLoading(false);
  };
  
  const safeArray = (val: any) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { 
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch(e) { 
        return val.split(',').map(s => s.trim()); 
      }
    }
    return [];
  };
  
  const canEdit = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.roles?.includes('LV_1')) return true; 
    if (!interfaceConfig) return false;

    const myRoles = currentUser.roles || [];
    const myEmail = currentUser.email;
    const myId = currentUser.id;
  
    const eRoles = safeArray(interfaceConfig.edit_role_ids);
    const tMasters = safeArray(interfaceConfig.task_masters);
    
    if (interfaceConfig.master_editor_id === myId) return true;
    if (myRoles.some((r: string) => eRoles.includes(r))) return true; 
    if (tMasters.some((tm: any) => tm.email === myEmail)) return true;
  
    return false;
  }, [currentUser, interfaceConfig]);
  
  const handleDelete = async (id: string) => {
    if (!canEdit) return alert('❌ 삭제 권한이 없습니다.');
    if (!confirm('정말 지급 신청을 철회하시겠습니까?\n(철회 시 카탈로그 재고가 자동으로 복구됩니다.)')) return;
    const res = await fetch(`/api/marketing/distributions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setDistributions(prev => prev.filter(d => d.id !== id));
      alert('지급 신청이 정상적으로 철회되었습니다.');
      fetchData();
    }
  };

  const handleCancelPurchase = async (id: string) => {
    if (!canEdit) return alert('❌ 입고 취소 권한이 없습니다.');
    if (!confirm('이 입고 내역을 취소하시겠습니까?\n(취소 시 카탈로그의 부서 재고도 함께 차감됩니다.)')) return;
    const res = await fetch(`/api/marketing/purchases?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('입고가 성공적으로 취소되었습니다.');
      fetchData();
    } else {
      alert('취소 실패. 이미 소진된 재고이거나 권한 에러입니다.');
    }
  };
  
  const availableYears = useMemo(() => {
    const years = distributions.map(d => new Date(d.createdAt).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a,b) => b.localeCompare(a));
    const currentYear = new Date().getFullYear().toString();
    if (!unique.includes(currentYear)) unique.push(currentYear);
    return unique;
  }, [distributions]);
  
  const baseFilteredList = useMemo(() => {
    return distributions.filter(d => {
      const yearMatch = selectedYear === 'ALL' || new Date(d.createdAt).getFullYear().toString() === selectedYear;
      const searchMatch = !searchQuery || 
        d.client_name.includes(searchQuery) || 
        d.item?.name?.includes(searchQuery) ||
        d.sender_name.includes(searchQuery);
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [distributions, selectedYear, searchQuery]);
  
  const totalAmountForYear = useMemo(() => {
    return baseFilteredList.reduce((acc, cur) => acc + (cur.item?.unit_price || 0) * cur.qty, 0);
  }, [baseFilteredList]);

  const clientStats = useMemo(() => {
    const statsMap: Record<string, number> = {};
    baseFilteredList.forEach(d => {
      const amount = (d.item?.unit_price || 0) * d.qty;
      statsMap[d.client_name] = (statsMap[d.client_name] || 0) + amount;
    });
    
    return Object.entries(statsMap)
      .map(([name, price]) => ({
        name, price,
        percent: totalAmountForYear > 0 ? ((price / totalAmountForYear) * 100).toFixed(1) : '0.0'
      })).sort((a, b) => b.price - a.price);
  }, [baseFilteredList, totalAmountForYear]);

  const finalFilteredList = useMemo(() => {
    if (!selectedClientFilter) return baseFilteredList;
    return baseFilteredList.filter(d => d.client_name === selectedClientFilter);
  }, [baseFilteredList, selectedClientFilter]);
  
  const totalPages = Math.max(1, Math.ceil(finalFilteredList.length / itemsPerPage));
  const paginatedList = finalFilteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [selectedYear, searchQuery, selectedClientFilter]);
  
  const toggleAll = () => {
    const currentPageIds = paginatedList.map(d => d.id);
    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) currentPageIds.forEach(id => next.delete(id));
    else currentPageIds.forEach(id => next.add(id));
    setSelectedIds(next);
  };
  
  const myDeptPurchases = useMemo(() => {
    if (!currentUser?.unit?.unit_name) return [];
    return purchases.filter(p => p.purchaser_dept === currentUser.unit.unit_name);
  }, [purchases, currentUser]);

  const purchaseYears = useMemo(() => {
    const years = myDeptPurchases.map(p => new Date(p.purchase_date).getFullYear().toString());
    const unique = Array.from(new Set(years)).sort((a, b) => b.localeCompare(a));
    const curYear = new Date().getFullYear().toString();
    if (!unique.includes(curYear)) unique.push(curYear);
    return unique;
  }, [myDeptPurchases]);

  const baseFilteredPurchases = useMemo(() => {
    return myDeptPurchases.filter(p => {
      const yearMatch = purchaseYear === 'ALL' || new Date(p.purchase_date).getFullYear().toString() === purchaseYear;
      const searchMatch = !purchaseSearch ||
        p.item?.name?.toLowerCase().includes(purchaseSearch.toLowerCase()) ||
        p.vendor?.toLowerCase().includes(purchaseSearch.toLowerCase()) ||
        p.purchaser_name?.toLowerCase().includes(purchaseSearch.toLowerCase());
      return yearMatch && searchMatch;
    }).sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());
  }, [myDeptPurchases, purchaseYear, purchaseSearch]);

  const totalPurchaseAmount = useMemo(() => {
    return baseFilteredPurchases.reduce((acc, cur) => acc + (cur.total_price || 0), 0);
  }, [baseFilteredPurchases]);

  const purchaseItemStats = useMemo(() => {
    const statsMap: Record<string, number> = {};
    baseFilteredPurchases.forEach(p => {
      const itemName = p.item?.name || '(삭제된 물품)';
      statsMap[itemName] = (statsMap[itemName] || 0) + (p.total_price || 0);
    });

    return Object.entries(statsMap)
      .map(([name, price]) => ({
        name, price,
        percent: totalPurchaseAmount > 0 ? ((price / totalPurchaseAmount) * 100).toFixed(1) : '0.0'
      })).sort((a, b) => b.price - a.price);
  }, [baseFilteredPurchases, totalPurchaseAmount]);

  const finalFilteredPurchases = useMemo(() => {
    if (!selectedItemFilter) return baseFilteredPurchases;
    return baseFilteredPurchases.filter(p => (p.item?.name || '(삭제된 물품)') === selectedItemFilter);
  }, [baseFilteredPurchases, selectedItemFilter]);

  const totalPurchasePages = Math.max(1, Math.ceil(finalFilteredPurchases.length / itemsPerPage));
  const paginatedPurchases = finalFilteredPurchases.slice((currentPurchasePage - 1) * itemsPerPage, currentPurchasePage * itemsPerPage);

  useEffect(() => { setCurrentPurchasePage(1); setSelectedPurchaseIds(new Set()); }, [purchaseYear, purchaseSearch, selectedItemFilter]);

  const toggleAllPurchases = () => {
    const currentIds = paginatedPurchases.map(p => p.id);
    const allSelected = currentIds.length > 0 && currentIds.every(id => selectedPurchaseIds.has(id));
    const next = new Set(selectedPurchaseIds);
    if (allSelected) currentIds.forEach(id => next.delete(id));
    else currentIds.forEach(id => next.add(id));
    setSelectedPurchaseIds(next);
  };

  const myDeptActiveItems = useMemo(() => {
    if (!currentUser?.unit?.unit_name) return [];
    return items.filter(item => !item.is_archived && item.owner_dept === currentUser.unit.unit_name);
  }, [items, currentUser]);

  const handleDownloadExcel = () => {
    const targetList = selectedIds.size > 0 ? distributions.filter(d => selectedIds.has(d.id)) : finalFilteredList;
    if (targetList.length === 0) return alert("다운로드할 데이터가 없습니다.");
    const exportData = targetList.map((d, i) => ({
      '지급신청일': new Date(d.createdAt).toISOString().split('T')[0],
      '고객사(회사명)': d.client_name,
      '고객사 부서': d.client_dept,
      '물품명': d.item?.name || '(삭제됨)',
      '단가(원)': d.item?.unit_price,
      '개수': d.qty,
      '총금액(원)': (d.item?.unit_price || 0) * d.qty,
      '지급목적': d.purpose,
      '신청자': d.sender_name,
      '소속부서': d.sender_dept
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서지급현황");
    XLSX.writeFile(wb, `${currentUser?.unit?.unit_name || '부서'}_지급현황대장_${selectedYear}년.xlsx`);
  };

  const handleDownloadPurchaseExcel = () => {
    const targetList = selectedPurchaseIds.size > 0 ? purchases.filter(p => selectedPurchaseIds.has(p.id)) : finalFilteredPurchases;
    if (targetList.length === 0) return alert("다운로드할 입고 데이터가 없습니다.");
    const exportData = targetList.map((p, i) => ({
      '입고일자': new Date(p.purchase_date).toISOString().split('T')[0],
      '물품명': p.item?.name || '(삭제됨)',
      '단가(원)': p.unit_price,
      '수량': p.qty,
      '총 금액(원)': p.total_price,
      '구매/공급처': p.vendor || '-',
      '비고(메모)': p.note || '-',
      '등록자': p.purchaser_name,
      '소속부서': p.purchaser_dept
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "부서입고현황");
    XLSX.writeFile(wb, `${currentUser?.unit?.unit_name || '부서'}_물품입고대장_${purchaseYear}년.xlsx`);
  };
  
  if (loading) return <div className="p-10 font-black text-center text-indigo-400 animate-pulse mt-20 tracking-widest">Syncing Department Master Ledger...</div>;
  
  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6 p-8 font-sans text-slate-900 pb-24 animate-fade-in">
      
      {/* 메인 배너 */}
      <div className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 p-6 rounded-[2.5rem] min-h-[120px] flex flex-col justify-center text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <p className="text-[10px] text-blue-200 font-black uppercase tracking-widest mb-1">Department Distribution Status</p>
          <h1 className="text-2xl font-black tracking-tight">
            <span>🏢</span> <span className="text-blue-300">{currentUser?.unit?.unit_name || '소속 부서'}</span> 지급 현황 대장
          </h1>
          <p className="text-blue-100 text-xs font-semibold mt-2 opacity-90">우리 부서원들이 고객사를 대상으로 등록하고 지급한 기념품 전체 이력을 모니터링합니다.</p>
        </div>
      </div>

      {/* 실시간 요약 그래프 */}
      <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4 px-2 border-b border-slate-100 pb-3">
          <span className="text-lg">📊</span>
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">우리 부서 관리물품별 실시간 재고 현황 그래프</h3>
        </div>
        
        {myDeptActiveItems.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs font-bold">현재 부서에 할당되어 활성화된 카탈로그 품목이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myDeptActiveItems.map(item => {
              const maxScale = Math.max(item.alert_qty * 3, item.current_stock, 10);
              const stockPercent = Math.min((item.current_stock / maxScale) * 100, 100);
              const isWarning = item.alert_qty > 0 && item.current_stock <= item.alert_qty;

              return (
                <div key={item.id} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 shadow-inner flex flex-col justify-center">
                  <div className="flex justify-between items-center mb-1.5 text-xs font-bold">
                    <span className="text-slate-800 font-black truncate">{item.name}</span>
                    <span className="font-mono text-slate-500">
                      현재재고: <strong className={isWarning ? 'text-red-500' : 'text-indigo-600'}>{item.current_stock}</strong> / <span className="text-[10px]">기준 {item.alert_qty}</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden relative">
                    <div 
                      style={{ width: `${stockPercent}%` }}
                      className={`h-full transition-all duration-500 ${isWarning ? 'bg-gradient-to-r from-red-400 to-red-500 animate-pulse' : 'bg-gradient-to-r from-blue-500 to-indigo-600'}`}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
  
      {/* 부서 지급 이력 대장 테이블 컨테이너 */}
      <div className="mt-6 bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
        <HeaderLight title="부서 지급 이력 대장" count={finalFilteredList.length}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
              <span>🗓️ 연도:</span>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                <option value="ALL">전체 내역 보기</option>
                {availableYears.map(y => <option key={y} value={y}>{y}년도</option>)}
              </select>
            </div>
            <button onClick={handleDownloadExcel} className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700">
              {selectedIds.size > 0 ? `선택 엑셀 다운로드 (${selectedIds.size})` : '화면 목록 엑셀 다운로드'}
            </button>
            <div className="relative w-40">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">🔍</span>
              <input type="text" placeholder="물품, 고객사, 사원 검색..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-6 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-indigo-500 transition-all shadow-inner" />
            </div>
          </div>
        </HeaderLight>

        <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">부서 총 지급액 ({selectedYear === 'ALL' ? '전체' : `${selectedYear}년`})</span>
            <div className="text-xl font-mono font-black text-indigo-600 mt-1">
              {totalAmountForYear.toLocaleString()} <span className="text-xs text-slate-500 font-sans font-bold">원</span>
            </div>
          </div>
          
          <div className="lg:col-span-9 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2 block">
              고객사별 지급 비율 요약 (클릭하여 해당 내역만 필터링)
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide max-h-[64px]">
              {clientStats.length === 0 ? (
                <span className="text-xs text-slate-400 font-bold py-2">지급 통계 데이터가 존재하지 않습니다.</span>
              ) : clientStats.map(stat => {
                const isSelected = selectedClientFilter === stat.name;
                return (
                  <div 
                    key={stat.name} 
                    onClick={() => setSelectedClientFilter(prev => prev === stat.name ? null : stat.name)}
                    className={`shrink-0 border rounded-xl px-3 py-1.5 flex flex-col justify-center text-right min-w-[120px] max-w-[180px] cursor-pointer transition-colors ${
                      isSelected 
                        ? 'bg-indigo-100 border-indigo-300 shadow-sm' 
                        : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <span className={`text-[10px] font-black truncate text-left ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{stat.name}</span>
                    <span className="text-[11px] font-mono font-black text-indigo-600 mt-0.5">
                      {stat.price.toLocaleString()}원 
                      <strong className={`text-[10px] ml-1 ${isSelected ? 'text-indigo-600' : 'text-emerald-500'}`}>
                        ({stat.percent}%)
                      </strong>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
  
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px] xl:min-w-full">
            <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
              <tr>
                <th className="h-12 pl-4 w-10 text-center">
                  <input type="checkbox" checked={paginatedList.length > 0 && paginatedList.every(d => selectedIds.has(d.id))} onChange={toggleAll} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                </th>
                <th className="h-12 px-2 w-24">지급신청일</th>
                <th className="h-12 px-2 w-32 text-emerald-600">고객사</th>
                <th className="h-12 px-2 w-24">고객사부서</th>
                <th className="h-12 px-2 w-32 text-indigo-600">물품명</th>
                <th className="h-12 px-2 w-24 text-right">단가(원)</th>
                <th className="h-12 px-2 w-16 text-center">개수</th>
                <th className="h-12 px-2 w-24 text-right text-indigo-600">총금액(원)</th>
                <th className="h-12 px-2 w-36 text-left">지급목적</th>
                <th className="h-12 px-2 w-16 text-center">신청자</th>
                <th className="h-12 px-2 w-24 text-center">소속부서</th>
                <th className="h-12 pr-4 text-center w-20">관리기능</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
              {paginatedList.length === 0 ? (
                <tr><td colSpan={12} className="p-16 text-center text-slate-400">부서 지급 내역 장부가 비어있습니다.</td></tr>
              ) : paginatedList.map((d, idx) => {
                const isSelected = selectedIds.has(d.id);
                const reqDate = new Date(d.createdAt).toISOString().split('T')[0];
                
                return (
                  <tr key={d.id} className={`transition-colors h-14 ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                    <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedIds); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelectedIds(next); }} className="w-3 h-3 accent-indigo-600 cursor-pointer" />
                    </td>
                    <td className="px-2 font-mono text-slate-500">{reqDate}</td>
                    <td className="px-2 font-black text-emerald-700 text-[12px] truncate max-w-[130px]">{d.client_name}</td>
                    <td className="px-2 text-slate-500 truncate max-w-[100px]">{d.client_dept || '-'}</td>
                    <td className="px-2 text-indigo-700 text-[12px] truncate max-w-[140px]">{d.item?.name || '(삭제됨)'}</td>
                    <td className="px-2 text-right font-mono text-slate-500">{d.item?.unit_price?.toLocaleString()}</td>
                    <td className="px-2 text-center bg-slate-50/50 font-mono">{d.qty} <span className="text-[9px] text-slate-400 font-sans">{d.item?.unit || 'EA'}</span></td>
                    <td className="px-2 text-right font-mono font-black text-indigo-600 bg-indigo-50/30">
                      {((d.item?.unit_price || 0) * d.qty).toLocaleString()}
                    </td>
                    <td className="px-2 text-slate-500 truncate max-w-[150px]" title={d.purpose}>{d.purpose}</td>
                    <td className="px-2 text-center text-slate-800 text-[11px] truncate max-w-[60px]">{d.sender_name}</td>
                    <td className="px-2 text-center text-[10px] text-slate-400 truncate max-w-[100px]">{d.sender_dept}</td>
                    <td className="pr-4 text-center" onClick={(e)=>e.stopPropagation()}>
                      {canEdit ? (
                        <button onClick={() => handleDelete(d.id)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                          신청철회
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300 font-bold">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 mt-4 bg-white">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
            ))}
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 🚀 부서 전용 물품 입고 내역 배너 및 컨테이너 */}
      {/* ========================================================================= */}
      <div 
        onClick={() => setIsPurchaseOpen(!isPurchaseOpen)}
        className="w-full bg-slate-800 p-6 rounded-[2.5rem] text-white shadow-lg relative overflow-hidden flex flex-col justify-center min-h-[120px] mt-12 cursor-pointer hover:brightness-95 active:scale-[0.99] transition-all select-none"
      >
        <div className="relative z-10">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Inbound Purchase Master Ledger (Click to Toggle)</p>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
             우리 부서 기념품 입고(재고보충) 내역 대장
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
              {isPurchaseOpen ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </h2>
          <p className="text-slate-300 text-xs font-semibold mt-2 opacity-90">카탈로그 마스터에서 입고 처리하여 우리 부서의 재고로 충전된 전체 물품 매입 장부를 추적합니다.</p>
        </div>
      </div>

      {isPurchaseOpen && (
        <div className="bg-white border border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden mt-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <HeaderLight title="부서 입고 내역 장부" count={finalFilteredPurchases.length}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-300 shadow-sm text-[10px] font-bold text-slate-600">
                <span>🗓️ 연도:</span>
                <select value={purchaseYear} onChange={e => setPurchaseYear(e.target.value)} className="outline-none bg-transparent cursor-pointer font-black">
                  <option value="ALL">전체 입고 보기</option>
                  {purchaseYears.map(y => <option key={y} value={y}>{y}년도</option>)}
                </select>
              </div>
              
              <button 
                onClick={handleDownloadPurchaseExcel}
                className="text-[10px] font-bold bg-white border border-slate-300 rounded-lg px-2.5 py-1 outline-none hover:bg-slate-50 transition-colors shadow-sm text-slate-700"
              >
                {selectedPurchaseIds.size > 0 ? `선택 입고 엑셀 다운 (${selectedPurchaseIds.size})` : '입고 장부 엑셀 다운'}
              </button>

              <div className="relative w-40">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px]">🔍</span>
                <input type="text" placeholder="물품, 공급처 검색..." value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} className="w-full pl-6 pr-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-indigo-500 transition-all shadow-inner" />
              </div>
            </div>
          </HeaderLight>

          <div className="p-6 bg-slate-50/70 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-h-[110px] flex flex-col justify-center">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">부서 총 입고(구매)액</span>
              <div className="text-xl font-mono font-black text-emerald-600 mt-1">
                {totalPurchaseAmount.toLocaleString()} <span className="text-xs text-slate-500 font-sans font-bold">원</span>
              </div>
            </div>
            
            <div className="lg:col-span-9 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-2 block">
                💰 비용 최다 지출 물품 순위 나열 (클릭 시 해당 품목만 필터링)
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide max-h-[64px]">
                {purchaseItemStats.length === 0 ? (
                  <span className="text-xs text-slate-400 font-bold py-2">입고 매입 통계가 존재하지 않습니다.</span>
                ) : purchaseItemStats.map(stat => {
                  const isSelected = selectedItemFilter === stat.name;
                  return (
                    <div 
                      key={stat.name} 
                      onClick={() => setSelectedItemFilter(prev => prev === stat.name ? null : stat.name)}
                      // 🚀 UI 깨짐 오타 완벽 수정 (min-w-[1300px] -> min-w-[120px])
                      className={`shrink-0 border rounded-xl px-3 py-1.5 flex flex-col justify-center text-right min-w-[120px] max-w-[180px] cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-100 border-emerald-300' : 'bg-slate-50 border-slate-200 hover:bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className="text-[10px] font-black text-slate-700 truncate text-left">{stat.name}</span>
                      <span className="text-[11px] font-mono font-black text-emerald-600 mt-0.5">
                        {stat.price.toLocaleString()}원 <strong className="text-indigo-500 text-[10px] ml-0.5">({stat.percent}%)</strong>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 🚀 입고 테이블 칼럼 순서 요청대로 재배치 */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px] xl:min-w-full">
              <thead className="bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest border-b border-slate-200">
                <tr>
                  <th className="h-12 pl-4 w-10 text-center">
                    <input type="checkbox" checked={paginatedPurchases.length > 0 && paginatedPurchases.every(p => selectedPurchaseIds.has(p.id))} onChange={toggleAllPurchases} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                  </th>
                  <th className="h-12 px-2 w-24">입고일자</th>
                  <th className="h-12 px-2 w-40 text-indigo-600">물품명</th>
                  <th className="h-12 px-2 w-24 text-right">단가(원)</th>
                  <th className="h-12 px-2 w-16 text-center">개수</th>
                  <th className="h-12 px-2 w-28 text-right text-emerald-600">총금액(원)</th>
                  <th className="h-12 px-2 w-32 text-emerald-600">구매/공급처</th>
                  <th className="h-12 px-2 w-48 text-left">비고 (공급처 메모)</th>
                  <th className="h-12 px-2 w-16 text-center">등록자</th>
                  <th className="h-12 px-2 w-24 text-center">소속부서</th>
                  <th className="h-12 pr-4 text-center w-20">관리기능</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-slate-700">
                {paginatedPurchases.length === 0 ? (
                  <tr><td colSpan={11} className="p-16 text-center text-slate-400">부서에 배정된 매입 입고 데이터가 없습니다.</td></tr>
                ) : paginatedPurchases.map((p, idx) => {
                  const isSelected = selectedPurchaseIds.has(p.id);
                  const pDate = new Date(p.purchase_date).toISOString().split('T')[0];

                  return (
                    <tr key={p.id} className={`transition-colors h-14 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50/50'}`}>
                      <td className="pl-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => { const next = new Set(selectedPurchaseIds); next.has(p.id) ? next.delete(p.id) : next.add(p.id); setSelectedPurchaseIds(next); }} className="w-3 h-3 accent-emerald-600 cursor-pointer" />
                      </td>
                      <td className="px-2 font-mono text-slate-500">{pDate}</td>
                      <td className="px-2 text-indigo-700 text-[12px] truncate max-w-[160px]">{p.item?.name || '(삭제됨)'}</td>
                      <td className="px-2 text-right font-mono text-slate-500">{p.unit_price?.toLocaleString()}</td>
                      <td className="px-2 text-center bg-slate-50/50 font-mono">{p.qty} <span className="text-[9px] text-slate-400 font-sans">{p.item?.unit || 'EA'}</span></td>
                      <td className="px-2 text-right font-mono font-black text-emerald-600 bg-emerald-50/30">{(p.total_price || 0).toLocaleString()}</td>
                      <td className="px-2 font-black text-emerald-700 truncate max-w-[130px]">{p.vendor || '-'}</td>
                      <td className="px-2 text-slate-500 truncate max-w-[200px]" title={p.note}>{p.note || '-'}</td>
                      <td className="px-2 text-center text-slate-800 text-[11px] truncate max-w-[60px]">{p.purchaser_name}</td>
                      <td className="px-2 text-center text-[10px] text-slate-400 truncate max-w-[100px]">{p.purchaser_dept}</td>
                      <td className="pr-4 text-center" onClick={(e)=>e.stopPropagation()}>
                        {canEdit ? (
                          <button onClick={() => handleCancelPurchase(p.id)} className="w-full py-1.5 bg-red-50 text-red-500 border border-red-100 rounded-md text-[9px] font-black hover:bg-red-500 hover:text-white transition-colors shadow-sm whitespace-nowrap">
                            입고 취소
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-300 font-bold">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 입고 하단 페이지네이션 */}
          {totalPurchasePages > 1 && (
            <div className="flex justify-center items-center gap-1.5 pt-6 pb-6 border-t border-slate-100 bg-white">
              <button disabled={currentPurchasePage === 1} onClick={() => setCurrentPurchasePage(p => p - 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">이전</button>
              {Array.from({ length: totalPurchasePages }).map((_, i) => (
                <button key={i} onClick={() => setCurrentPurchasePage(i + 1)} className={`w-8 h-8 rounded-xl font-black text-xs transition-all ${currentPurchasePage === i + 1 ? 'bg-slate-800 text-white shadow-sm scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{i + 1}</button>
              ))}
              <button disabled={currentPurchasePage === totalPurchasePages} onClick={() => setCurrentPurchasePage(p => p + 1)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50">다음</button>
            </div>
          )}
        </div>
      )}
  
    </div>
  );
}
  
export default function DeptDistributionModule() {
  return (
    <Suspense fallback={<div className="p-10 text-center font-black animate-pulse text-indigo-400 mt-20 tracking-widest">Loading Department Combined Environment...</div>}>
      <DeptDistributionContent />
    </Suspense>
  );
}